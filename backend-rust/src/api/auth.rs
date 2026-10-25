use crate::{
    api::deps::{header_cookie, session_generation, validate_session, ApiError, AppState, AuthUser, Csrf},
    core::{
        ldap,
        security::{
            create_refresh_token, create_session_token, decode_refresh_token, derive_csrf_token,
            credential_fingerprint, hash_password, verify_credential_fingerprint, verify_password,
        },
    },
    models::user::User,
    schemas::auth::{
        self, LoginRequest, LoginResponse, SetupAdminRequest, SetupStatusResponse, UserRead,
    },
};
use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use parking_lot::Mutex;
use std::{
    collections::{HashMap, VecDeque},
    sync::LazyLock,
    time::{Duration, Instant},
};
use uuid::Uuid;
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/setup", get(setup_status).post(setup_admin))
        .route("/auth/login", post(login))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
}
const ATTEMPT_WINDOW: Duration = Duration::from_secs(60);
const MAX_ATTEMPT_KEYS: usize = 4096;
struct Attempts {
    queues: HashMap<(String, &'static str), VecDeque<Instant>>,
    swept_at: Instant,
}
impl Attempts {
    fn new(now: Instant) -> Self {
        Self { queues: HashMap::new(), swept_at: now }
    }
    fn check(&mut self, scope: String, path: &'static str, limit: usize, now: Instant) -> Result<(), ApiError> {
        if now.duration_since(self.swept_at) >= Duration::from_secs(1)
            || self.queues.len() >= MAX_ATTEMPT_KEYS
        {
            self.queues.retain(|_, queue| {
                while queue.front().is_some_and(|t| now.duration_since(*t) >= ATTEMPT_WINDOW) {
                    queue.pop_front();
                }
                !queue.is_empty()
            });
            self.swept_at = now;
        }
        let key = (scope, path);
        if self.queues.len() >= MAX_ATTEMPT_KEYS && !self.queues.contains_key(&key) {
            return Err(ApiError::new(StatusCode::TOO_MANY_REQUESTS, "Login limiter capacity reached"));
        }
        let queue = self.queues.entry(key).or_default();
        while queue.front().is_some_and(|t| now.duration_since(*t) >= ATTEMPT_WINDOW) {
            queue.pop_front();
        }
        if queue.len() >= limit {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                format!("Rate limit exceeded: {limit} per 1 minute"),
            ));
        }
        queue.push_back(now);
        Ok(())
    }
}
static ATTEMPTS: LazyLock<Mutex<Attempts>> =
    LazyLock::new(|| Mutex::new(Attempts::new(Instant::now())));
fn peer(headers: &HeaderMap) -> String {
    headers
        .get("x-inventory-peer")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("remote")
        .to_owned()
}
fn rate(
    state: &AppState,
    scope: String,
    path: &'static str,
    limit: usize,
) -> Result<(), ApiError> {
    if state.settings.app_env == "test" {
        return Ok(());
    }
    ATTEMPTS.lock().check(scope, path, limit, Instant::now())
}
async fn setup_status(
    State(state): State<AppState>,
) -> Result<Json<SetupStatusResponse>, ApiError> {
    let count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM users")
        .fetch_one(&state.pool)
        .await
        .map_err(db)?;
    Ok(Json(SetupStatusResponse {
        setup_required: count == 0,
    }))
}
fn db(e: sqlx::Error) -> ApiError {
    ApiError::internal(e.to_string())
}
pub async fn cookies(state: &AppState, user: &User, persist: bool) -> Result<HeaderMap, ApiError> {
    let generation = session_generation(state).await?;
    let subject = user.id.to_string();
    let credential = credential_fingerprint(
        &subject, &user.auth_source, &user.password_hash, &state.settings.jwt_secret,
    );
    let token = create_session_token(
        &subject,
        user.role.as_str(),
        &generation,
        &credential,
        &state.settings.jwt_secret,
    )
    .map_err(|e| ApiError::internal(e.to_string()))?;
    let csrf = derive_csrf_token(&token, &state.settings.jwt_secret);
    let refresh = create_refresh_token(&subject, persist, &generation, &credential, &state.settings.jwt_secret)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let secure = if state.settings.secure_cookies {
        "; Secure"
    } else {
        ""
    };
    let mut headers = HeaderMap::new();
    for cookie in [
        format!(
            "{}={token}; HttpOnly; Path=/; SameSite=Lax{secure}",
            state.settings.session_cookie_name
        ),
        format!(
            "{}={csrf}; Path=/; SameSite=Lax{secure}",
            state.settings.csrf_cookie_name
        ),
        format!(
            "inventorymgr_refresh={refresh}; HttpOnly; Path=/api/auth/refresh; SameSite=Strict{}{}",
            if persist { "; Max-Age=604800" } else { "" },
            secure
        ),
    ] {
        headers.append(
            header::SET_COOKIE,
            HeaderValue::from_str(&cookie).map_err(|e| ApiError::internal(e.to_string()))?,
        );
    }
    Ok(headers)
}
async fn setup_admin(
    State(state): State<AppState>,
    headers: HeaderMap,
    crate::api::deps::ValidatedJson(payload): crate::api::deps::ValidatedJson<SetupAdminRequest>,
) -> Result<Response, ApiError> {
    rate(&state, peer(&headers), "setup", 3)?;
    let email = auth::email(&payload.email)?;
    auth::password(&payload.password)?;
    let mut tx = state.pool.begin().await.map_err(db)?;
    sqlx::query("LOCK TABLE users IN EXCLUSIVE MODE")
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM users")
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    if count > 0 {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Setup has already been completed",
        ));
    }
    let hash = hash_password(&payload.password).map_err(ApiError::internal)?;
    let user=sqlx::query_as::<_,User>("INSERT INTO users(id,email,password_hash,role,is_active,auth_source,preferences,created_at,updated_at) VALUES($1,$2,$3,'admin',true,'local','{}',now(),now()) RETURNING *").bind(Uuid::new_v4()).bind(email).bind(hash).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok((
        StatusCode::CREATED,
        cookies(&state, &user, true).await?,
        Json(LoginResponse { user: user.into() }),
    )
        .into_response())
}
async fn login(
    State(state): State<AppState>,
    crate::api::deps::ValidatedJson(payload): crate::api::deps::ValidatedJson<LoginRequest>,
) -> Result<Response, ApiError> {
    let email = auth::email(&payload.email)?;
    rate(&state, String::new(), "login-ingress", 300)?;
    rate(&state, email.clone(), "login", 10)?;
    let local = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email=$1")
        .bind(&email)
        .fetch_optional(&state.pool)
        .await
        .map_err(db)?;
    let user = match local {
        Some(u) if u.auth_source == "local" => {
            (u.is_active && verify_password(&payload.password, &u.password_hash)).then_some(u)
        }
        Some(u) if !u.is_active || u.auth_source != "ldap" => None,
        _ => {
            if let Some(config) = ldap::config(&state).await?.filter(|c| c.enabled) {
                rate(&state, ldap::lookup_filter(&config, &email), "ldap-login", 10)?;
                if payload.password.is_empty() {
                    None
                } else if let Ok(Some(entry)) =
                    ldap::resolve(&config, &state.settings.jwt_secret, &email).await
                {
                    rate(&state, entry.dn().to_owned(), "ldap-bind", 10)?;
                    ldap::authenticate_resolved(&state, &config, entry, &email, &payload.password).await?
                } else {
                    None
                }
            } else {
                None
            }
        }
    }
    .ok_or_else(|| ApiError::unauthorized("Invalid email or password"))?;
    Ok((
        cookies(&state, &user, payload.remember).await?,
        Json(LoginResponse { user: user.into() }),
    )
        .into_response())
}
async fn refresh(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, ApiError> {
    let token = header_cookie(&headers, "inventorymgr_refresh")
        .ok_or_else(|| ApiError::unauthorized("No refresh token"))?;
    let claims = decode_refresh_token(&token, &state.settings.jwt_secret)
        .map_err(|_| ApiError::unauthorized("Invalid refresh token"))?;
    if claims.r#type != "refresh" {
        return Err(ApiError::unauthorized("Invalid refresh token"));
    }
    let id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("Invalid refresh token"))?;
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id=$1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(db)?
        .filter(|u| u.is_active)
        .ok_or_else(|| ApiError::unauthorized("Inactive or missing user"))?;
    if !verify_credential_fingerprint(
        &claims.credential, &user.id.to_string(), &user.auth_source,
        &user.password_hash, &state.settings.jwt_secret,
    ) {
        return Err(ApiError::unauthorized("Session invalidated"));
    }
    validate_session(&state, claims.generation.as_deref(), claims.iat).await?;
    Ok((
        cookies(&state, &user, claims.persist).await?,
        Json(LoginResponse { user: user.into() }),
    )
        .into_response())
}
async fn logout(State(state): State<AppState>, _: AuthUser, _csrf: Csrf) -> Response {
    let secure = if state.settings.secure_cookies {
        "; Secure"
    } else {
        ""
    };
    let mut headers = HeaderMap::new();
    for cookie in [
        format!(
            "{}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax{secure}",
            state.settings.session_cookie_name
        ),
        format!(
            "{}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax{secure}",
            state.settings.csrf_cookie_name
        ),
        format!(
            "inventorymgr_refresh=; Path=/api/auth/refresh; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict{secure}"
        ),
    ] {
        headers.append(header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap());
    }
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    (StatusCode::NO_CONTENT, headers).into_response()
}
async fn me(AuthUser(user): AuthUser) -> Json<UserRead> {
    Json(user.into())
}

#[cfg(test)]
mod rate_tests {
    use super::*;

    #[test]
    fn login_limit_is_scoped_to_the_target_account() {
        let now = Instant::now();
        let mut attempts = Attempts::new(now);
        assert!(attempts.check("alice@example.com".into(), "login", 1, now).is_ok());
        assert_eq!(
            attempts.check("alice@example.com".into(), "login", 1, now).unwrap_err().status,
            StatusCode::TOO_MANY_REQUESTS
        );
        assert!(attempts.check("bob@example.com".into(), "login", 1, now).is_ok());
    }

    #[test]
    fn limiter_expires_idle_keys_without_evicting_active_accounts() {
        let now = Instant::now();
        let mut attempts = Attempts::new(now);
        for i in 0..MAX_ATTEMPT_KEYS - 1 {
            attempts.check(format!("attacker-{i}"), "login", 1, now).unwrap();
        }
        attempts.check("target".into(), "login", 1, now + Duration::from_secs(30)).unwrap();
        assert_eq!(attempts.queues.len(), MAX_ATTEMPT_KEYS);
        for i in 0..100 {
            assert_eq!(attempts.check(format!("overflow-{i}"), "login", 1, now + Duration::from_secs(30)).unwrap_err().status, StatusCode::TOO_MANY_REQUESTS);
        }
        assert_eq!(attempts.queues.len(), MAX_ATTEMPT_KEYS);
        assert!(attempts.check("fresh".into(), "login", 1, now + ATTEMPT_WINDOW).is_ok());
        assert_eq!(attempts.queues.len(), 2);
        assert_eq!(attempts.check("target".into(), "login", 1, now + ATTEMPT_WINDOW).unwrap_err().status, StatusCode::TOO_MANY_REQUESTS);
        assert!(attempts.check("target".into(), "login", 1, now + Duration::from_secs(90)).is_ok());
    }

    #[test]
    fn concurrent_attempts_cannot_exceed_the_account_budget() {
        let now = Instant::now();
        let attempts = Mutex::new(Attempts::new(now));
        let barrier = std::sync::Barrier::new(32);
        let accepted = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..32).map(|_| scope.spawn(|| {
                barrier.wait();
                attempts.lock().check("target".into(), "login", 10, now).is_ok()
            })).collect();
            handles.into_iter().map(|handle| usize::from(handle.join().unwrap())).sum::<usize>()
        });
        assert_eq!(accepted, 10);
        assert_eq!(attempts.lock().queues.len(), 1);
    }

    #[test]
    fn global_ingress_budget_bounds_distinct_identity_work() {
        let now = Instant::now();
        let mut attempts = Attempts::new(now);
        for _ in 0..300 {
            attempts.check(String::new(), "login-ingress", 300, now).unwrap();
        }
        assert_eq!(attempts.check(String::new(), "login-ingress", 300, now).unwrap_err().status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(attempts.queues.len(), 1);
        assert!(attempts.check(String::new(), "login-ingress", 300, now + ATTEMPT_WINDOW).is_ok());
    }
}

#[cfg(test)]
#[path = "auth_security_tests.rs"]
mod security_tests;
