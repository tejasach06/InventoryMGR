mod preferences;
mod settings;
use crate::{
    api::deps::{Admin, ApiError, AppState, Csrf, RequireRole},
    core::security::hash_password,
    models::user::{User, UserRole},
    schemas::auth::{self, UserRead},
};
use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users", get(list).post(create))
        .route("/users/{id}", patch(update).delete(delete))
        .merge(preferences::router())
        .merge(settings::router())
}
#[derive(Deserialize)]
struct Create {
    email: String,
    password: String,
    role: UserRole,
    #[serde(default = "yes")]
    is_active: bool,
}
fn yes() -> bool {
    true
}
#[derive(Deserialize)]
struct Patch {
    role: Option<UserRole>,
    is_active: Option<bool>,
    password: Option<String>,
}
fn db(e: sqlx::Error) -> ApiError {
    ApiError::internal(e.to_string())
}
async fn list(State(s): State<AppState>, _: Admin) -> Result<Json<Vec<UserRead>>, ApiError> {
    Ok(Json(
        sqlx::query_as::<_, User>("SELECT * FROM users ORDER BY email")
            .fetch_all(&s.pool)
            .await
            .map_err(db)?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}
async fn create(
    State(s): State<AppState>,
    _: Admin,
    _csrf: Csrf,
    crate::api::deps::ValidatedJson(p): crate::api::deps::ValidatedJson<Create>,
) -> Result<Response, ApiError> {
    let email = auth::email(&p.email)?;
    auth::password(&p.password)?;
    let hash = hash_password(&p.password).map_err(ApiError::internal)?;
    let user=sqlx::query_as::<_,User>("INSERT INTO users(id,email,password_hash,role,is_active,auth_source,preferences,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'local','{}',now(),now()) RETURNING *").bind(Uuid::new_v4()).bind(email).bind(hash).bind(p.role).bind(p.is_active).fetch_one(&s.pool).await.map_err(|e|if e.as_database_error().is_some_and(|e|e.is_unique_violation()){ApiError::new(StatusCode::CONFLICT,"User email already exists")}else{db(e)})?;
    Ok((StatusCode::CREATED, Json(UserRead::from(user))).into_response())
}
async fn update(
    State(s): State<AppState>,
    _: Admin,
    _csrf: Csrf,
    UserId(id): UserId,
    crate::api::deps::ValidatedJson(p): crate::api::deps::ValidatedJson<Patch>,
) -> Result<Json<UserRead>, ApiError> {
    if let Some(password) = &p.password {
        auth::password(password)?;
    }
    let mut tx = s.pool.begin().await.map_err(db)?;
    sqlx::query("LOCK TABLE users IN EXCLUSIVE MODE")
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let u = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id=$1")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?
        .ok_or_else(|| ApiError::not_found("User not found"))?;
    let role = p.role.unwrap_or(u.role.clone());
    let active = p.is_active.unwrap_or(u.is_active);
    if u.role == UserRole::Admin && u.is_active && (role != UserRole::Admin || !active) {
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM users WHERE role='admin' AND is_active",
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
        if count <= 1 {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "Cannot remove the last active admin",
            ));
        }
    }
    let hash = match p.password {
        Some(password) => hash_password(&password).map_err(ApiError::internal)?,
        None => u.password_hash,
    };
    let u=sqlx::query_as::<_,User>("UPDATE users SET role=$2,is_active=$3,password_hash=$4,updated_at=now() WHERE id=$1 RETURNING *").bind(id).bind(role).bind(active).bind(hash).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(Json(u.into()))
}
async fn delete(
    State(s): State<AppState>,
    RequireRole(current): Admin,
    _csrf: Csrf,
    UserId(id): UserId,
) -> Result<Response, ApiError> {
    let mut tx = s.pool.begin().await.map_err(db)?;
    sqlx::query("LOCK TABLE users IN EXCLUSIVE MODE")
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let u = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id=$1")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?
        .ok_or_else(|| ApiError::not_found("User not found"))?;
    if id == current.id {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "You cannot delete your own account",
        ));
    }
    if u.role == UserRole::Admin && u.is_active {
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM users WHERE role='admin' AND is_active",
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
        if count <= 1 {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "Cannot remove the last active admin",
            ));
        }
    }
    sqlx::query("DELETE FROM users WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::CONFLICT,
                "User has linked records (audit log, imports). Deactivate the account instead.",
            )
        })?;
    tx.commit().await.map_err(db)?;
    Ok((StatusCode::NO_CONTENT, [(header::CONTENT_TYPE, "application/json")]).into_response())
}
impl crate::api::deps::JsonSchema for Create {
    const FIELDS: &'static [(&'static str, bool, crate::api::deps::FieldKind)] = &[
        ("email", true, crate::api::deps::FieldKind::Email),
        ("password", true, crate::api::deps::FieldKind::Password),
        ("role", true, crate::api::deps::FieldKind::Role),
        ("is_active", false, crate::api::deps::FieldKind::Bool),
    ];
}
impl crate::api::deps::JsonSchema for Patch {
    const NULLABLE: &'static [&'static str] = &["role", "is_active", "password"];
    const FIELDS: &'static [(&'static str, bool, crate::api::deps::FieldKind)] = &[
        ("role", false, crate::api::deps::FieldKind::Role),
        ("is_active", false, crate::api::deps::FieldKind::Bool),
        ("password", false, crate::api::deps::FieldKind::Password),
    ];
}
struct UserId(Uuid);
impl axum::extract::FromRequestParts<AppState> for UserId {
    type Rejection = ApiError;
    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &AppState,
    ) -> Result<Self, ApiError> {
        let Path(value) = Path::<String>::from_request_parts(parts, state)
            .await
            .map_err(|e| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, e.to_string()))?;
        Uuid::parse_str(&value).map(Self).map_err(|_|{let error=if let Some((i,c))=value.chars().enumerate().find(|(_,c)|!c.is_ascii_hexdigit()&&*c!='-'){format!("invalid character: found `{c}` at {}",i+1)}else{format!("invalid length: expected length 32 for simple format, found {}",value.len())};ApiError::validation(vec![serde_json::json!({"type":"uuid_parsing","loc":["path","user_id"],"msg":format!("Input should be a valid UUID, {error}"),"input":value,"ctx":{"error":error}})])})
    }
}
