use crate::{
    api::deps::{header_cookie, session_epoch, ApiError, AppState, AuthUser, Csrf},
    core::{
        ldap,
        security::{
            create_refresh_token, create_session_token, decode_refresh_token, derive_csrf_token,
            hash_password, verify_password,
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
static ATTEMPTS: LazyLock<Mutex<HashMap<(String, &'static str), VecDeque<Instant>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
fn rate(
    state: &AppState,
    headers: &HeaderMap,
    path: &'static str,
    limit: usize,
) -> Result<(), ApiError> {
    if state.settings.app_env == "test" {
        return Ok(());
    }
    let ip = headers
        .get("x-inventory-peer")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("remote")
        .to_owned();
    let now = Instant::now();
    let mut attempts = ATTEMPTS.lock();
    let queue = attempts.entry((ip, path)).or_default();
    while queue
        .front()
        .is_some_and(|t| now.duration_since(*t) >= Duration::from_secs(60))
    {
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
pub fn cookies(state: &AppState, user: &User, persist: bool) -> Result<HeaderMap, ApiError> {
    let token = create_session_token(
        &user.id.to_string(),
        user.role.as_str(),
        &state.settings.jwt_secret,
    )
    .map_err(|e| ApiError::internal(e.to_string()))?;
    let csrf = derive_csrf_token(&token, &state.settings.jwt_secret);
    let refresh = create_refresh_token(&user.id.to_string(), persist, &state.settings.jwt_secret)
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
    rate(&state, &headers, "setup", 3)?;
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
        cookies(&state, &user, true)?,
        Json(LoginResponse { user: user.into() }),
    )
        .into_response())
}
async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    crate::api::deps::ValidatedJson(payload): crate::api::deps::ValidatedJson<LoginRequest>,
) -> Result<Response, ApiError> {
    rate(&state, &headers, "login", 10)?;
    let email = auth::email(&payload.email)?;
    let local = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email=$1")
        .bind(&email)
        .fetch_optional(&state.pool)
        .await
        .map_err(db)?;
    let user = match local {
        Some(u) if u.is_active && verify_password(&payload.password, &u.password_hash) => Some(u),
        _ => ldap::authenticate(&state, &email, &payload.password).await?,
    }
    .ok_or_else(|| ApiError::unauthorized("Invalid email or password"))?;
    Ok((
        cookies(&state, &user, payload.remember)?,
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
    if session_epoch(&state.pool).await? > claims.iat {
        return Err(ApiError::unauthorized("Session invalidated"));
    }
    Ok((
        cookies(&state, &user, claims.persist)?,
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
