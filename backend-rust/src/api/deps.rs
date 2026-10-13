use crate::{
    core::{
        config::Settings,
        security::{decode_session_token, verify_csrf_token},
    },
    models::user::User,
};
use axum::{
    body::HttpBody,
    extract::FromRequestParts,
    http::{header, request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub settings: Arc<Settings>,
    pub database_access: Arc<tokio::sync::RwLock<()>>,
}
#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
    pub detail: Option<serde_json::Value>,
}
impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            detail: None,
        }
    }
    pub fn validation(errors: Vec<serde_json::Value>) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            message: String::new(),
            detail: Some(json!(errors)),
        }
    }
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, message)
    }
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, message)
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = if self.status == StatusCode::TOO_MANY_REQUESTS {
            json!({"error":self.message})
        } else {
            json!({"detail":self.detail.unwrap_or(json!(self.message))})
        };
        (self.status, Json(body)).into_response()
    }
}
pub fn cookie(parts: &Parts, name: &str) -> Option<String> {
    header_cookie(&parts.headers, name)
}
pub fn header_cookie(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|c| {
            let (k, v) = c.trim().split_once('=')?;
            (k == name).then(|| v.to_owned())
        })
}
pub struct Csrf;
impl FromRequestParts<AppState> for Csrf {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let token = cookie(parts, &state.settings.session_cookie_name)
            .ok_or_else(|| ApiError::unauthorized("Not authenticated"))?;
        let provided = parts
            .headers
            .get("X-CSRF-Token")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !verify_csrf_token(provided, &token, &state.settings.jwt_secret) {
            return Err(ApiError::forbidden("Invalid CSRF token"));
        }
        Ok(Self)
    }
}
pub struct AuthUser(pub User);
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let token = cookie(parts, &state.settings.session_cookie_name)
            .ok_or_else(|| ApiError::unauthorized("Not authenticated"))?;
        let claims = decode_session_token(&token, &state.settings.jwt_secret)
            .map_err(|_| ApiError::unauthorized("Invalid session"))?;
        let id =
            Uuid::parse_str(&claims.sub).map_err(|_| ApiError::unauthorized("Invalid session"))?;
        let user=sqlx::query_as::<_,User>("SELECT id,email,password_hash,role,is_active,auth_source,preferences,created_at,updated_at FROM users WHERE id=$1").bind(id).fetch_optional(&state.pool).await.map_err(|e|ApiError::internal(e.to_string()))?.filter(|u|u.is_active).ok_or_else(||ApiError::unauthorized("Inactive or missing user"))?;
        if session_epoch(&state.pool).await? > claims.iat {
            return Err(ApiError::unauthorized("Session invalidated"));
        }
        Ok(Self(user))
    }
}
pub async fn session_epoch(pool: &PgPool) -> Result<i64, ApiError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT value FROM app_settings WHERE key='session_epoch'")
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
    )
}
pub struct RequireRole<const R: u8>(pub User);
impl<const R: u8> FromRequestParts<AppState> for RequireRole<R> {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let AuthUser(user) = AuthUser::from_request_parts(parts, state).await?;
        if user.role.rank() < R {
            return Err(ApiError::forbidden("Insufficient permissions"));
        }
        Ok(Self(user))
    }
}
pub type Viewer = RequireRole<1>;
pub type Editor = RequireRole<2>;
pub type Admin = RequireRole<3>;

#[derive(Clone, Copy)]
pub enum FieldKind {
    String,
    StrLen(usize, usize),
    Email,
    Password,
    Bool,
    Role,
    Accent,
    Int(i64, i64),
    Array,
}
pub trait JsonSchema: serde::de::DeserializeOwned + Send {
    const FIELDS: &'static [(&'static str, bool, FieldKind)];
    const NULLABLE: &'static [&'static str] = &[];
    fn extra_errors(_value: &mut serde_json::Value) -> Vec<serde_json::Value> {
        Vec::new()
    }
}
pub struct ValidatedJson<T>(pub T);
impl<T: JsonSchema> axum::extract::FromRequest<AppState> for ValidatedJson<T> {
    type Rejection = ApiError;
    async fn from_request(req: axum::extract::Request, state: &AppState) -> Result<Self, ApiError> {
        let empty_body = req.body().size_hint().upper() == Some(0);
        let Json(mut value) = Json::<serde_json::Value>::from_request(req, state)
            .await
            .map_err(|e| {
                if empty_body {
                    return ApiError::validation(vec![
                        json!({"type":"missing","loc":["body"],"msg":"Field required","input":null}),
                    ]);
                }
                ApiError::validation(vec![
                    json!({"type":"json_invalid","loc":["body"],"msg":e.body_text(),"input":{}}),
                ])
            })?;
        let mut errors = validate_fields(&mut value, T::FIELDS, T::NULLABLE, &[json!("body")]);
        if errors.is_empty() {
            errors.extend(T::extra_errors(&mut value));
        }
        if !errors.is_empty() {
            return Err(ApiError::validation(errors));
        }
        serde_json::from_value(value).map(Self).map_err(|e| {
            ApiError::validation(vec![
                json!({"type":"value_error","loc":["body"],"msg":e.to_string(),"input":{}}),
            ])
        })
    }
}
impl JsonSchema for serde_json::Value {
    const FIELDS: &'static [(&'static str, bool, FieldKind)] = &[];
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::FromRequest;
    #[tokio::test]
    async fn setup_missing_fields_matches_source_errors() {
        let state = AppState {
            pool: sqlx::postgres::PgPoolOptions::new()
                .connect_lazy("postgresql://localhost/unused")
                .unwrap(),
            settings: Arc::new(Settings::from_env()),
            database_access: Arc::new(tokio::sync::RwLock::new(())),
        };
        let req = axum::http::Request::builder()
            .header("content-type", "application/json")
            .body(axum::body::Body::from("{}"))
            .unwrap();
        let result =
            ValidatedJson::<crate::schemas::auth::SetupAdminRequest>::from_request(req, &state)
                .await;
        let Err(error) = result else {
            panic!("missing setup fields accepted")
        };
        assert_eq!(error.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            error.detail,
            Some(
                json!([{"type":"missing","loc":["body","email"],"msg":"Field required","input":{}},{"type":"missing","loc":["body","password"],"msg":"Field required","input":{}}])
            )
        );
    }
    #[tokio::test]
    async fn empty_json_body_matches_required_body_error() {
        let state = AppState {
            pool: sqlx::postgres::PgPoolOptions::new()
                .connect_lazy("postgresql://localhost/unused")
                .unwrap(),
            settings: Arc::new(Settings::from_env()),
            database_access: Arc::new(tokio::sync::RwLock::new(())),
        };
        for content_type in [None, Some("application/json")] {
            let mut request = axum::http::Request::builder();
            if let Some(content_type) = content_type {
                request = request.header("content-type", content_type);
            }
            let request = request.body(axum::body::Body::empty()).unwrap();
            let result = ValidatedJson::<serde_json::Value>::from_request(request, &state).await;
            let Err(error) = result else {
                panic!("empty body accepted")
            };
            assert_eq!(error.status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(error.detail, Some(json!([
                {"type":"missing","loc":["body"],"msg":"Field required","input":null}
            ])));
        }
    }
}
pub fn validate_fields(
    value: &mut serde_json::Value,
    fields: &[(&str, bool, FieldKind)],
    nullable: &[&str],
    prefix: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    let mut errors = Vec::new();
    for &(field, required, kind) in fields {
        let mut loc = prefix.to_vec();
        loc.push(json!(field));
        let Some(input) = value.get_mut(field) else {
            if required {
                errors
                    .push(json!({"type":"missing","loc":loc,"msg":"Field required","input":value}));
            }
            continue;
        };
        if input.is_null() && nullable.contains(&field) {
            continue;
        }
        let original = input.clone();
        match kind {
            FieldKind::Bool if !input.is_boolean() => {
                let coerced = match input {
                    serde_json::Value::String(s) => match s.to_lowercase().as_str() {
                        "1" | "true" | "t" | "yes" | "y" | "on" => Some(true),
                        "0" | "false" | "f" | "no" | "n" | "off" => Some(false),
                        _ => None,
                    },
                    serde_json::Value::Number(n) => match n.as_i64() {
                        Some(0) => Some(false),
                        Some(1) => Some(true),
                        _ => None,
                    },
                    _ => None,
                };
                if let Some(b) = coerced {
                    *input = json!(b);
                }
            }
            FieldKind::Int(_, _) if input.as_i64().is_none() => {
                let coerced = input
                    .as_str()
                    .and_then(|s| s.trim().parse::<i64>().ok())
                    .or_else(|| {
                        input
                            .as_f64()
                            .filter(|n| n.fract() == 0.0)
                            .map(|n| n as i64)
                    });
                if let Some(n) = coerced {
                    *input = json!(n);
                }
            }
            _ => {}
        }
        let error = match kind {
            FieldKind::String
            | FieldKind::StrLen(_, _)
            | FieldKind::Email
            | FieldKind::Password
                if !input.is_string() =>
            {
                Some((
                    "string_type",
                    "Input should be a valid string".to_owned(),
                    None,
                ))
            }
            FieldKind::Email if crate::schemas::auth::email(input.as_str().unwrap()).is_err() => {
                Some((
                    "value_error",
                    "Value error, must be a valid email address".into(),
                    Some(json!({"error":{}})),
                ))
            }
            FieldKind::Password if input.as_str().unwrap().chars().count() < 8 => Some((
                "string_too_short",
                "String should have at least 8 characters".into(),
                Some(json!({"min_length":8})),
            )),
            FieldKind::StrLen(min, _) if input.as_str().unwrap().chars().count() < min => Some((
                "string_too_short",
                format!(
                    "String should have at least {min} character{}",
                    if min == 1 { "" } else { "s" }
                ),
                Some(json!({"min_length":min})),
            )),
            FieldKind::StrLen(_, max) if input.as_str().unwrap().chars().count() > max => Some((
                "string_too_long",
                format!("String should have at most {max} characters"),
                Some(json!({"max_length":max})),
            )),
            FieldKind::Role
                if !["admin", "editor", "viewer"].contains(&input.as_str().unwrap_or("")) =>
            {
                Some((
                    "enum",
                    "Input should be 'admin', 'editor' or 'viewer'".into(),
                    Some(json!({"expected":"'admin', 'editor' or 'viewer'"})),
                ))
            }
            FieldKind::Accent
                if !["orange", "blue", "violet", "emerald", "rose", "amber"]
                    .contains(&input.as_str().unwrap_or("")) =>
            {
                Some((
                    "literal_error",
                    "Input should be 'orange', 'blue', 'violet', 'emerald', 'rose' or 'amber'"
                        .into(),
                    Some(
                        json!({"expected":"'orange', 'blue', 'violet', 'emerald', 'rose' or 'amber'"}),
                    ),
                ))
            }
            FieldKind::Bool if input.is_null() || input.is_object() || input.is_array() => {
                Some(("bool_type", "Input should be a valid boolean".into(), None))
            }
            FieldKind::Bool if !input.is_boolean() => Some((
                "bool_parsing",
                "Input should be a valid boolean, unable to interpret input".into(),
                None,
            )),
            FieldKind::Int(_, _) if input.is_null() || input.is_object() || input.is_array() => {
                Some(("int_type", "Input should be a valid integer".into(), None))
            }
            FieldKind::Int(_, _) if input.as_f64().is_some_and(|n| n.fract() != 0.0) => Some((
                "int_from_float",
                "Input should be a valid integer, got a number with a fractional part".into(),
                None,
            )),
            FieldKind::Int(_, _) if input.as_i64().is_none() => Some((
                "int_parsing",
                "Input should be a valid integer, unable to parse string as an integer".into(),
                None,
            )),
            FieldKind::Int(min, _) if input.as_i64().unwrap() < min => Some((
                "greater_than_equal",
                format!("Input should be greater than or equal to {min}"),
                Some(json!({"ge":min})),
            )),
            FieldKind::Int(_, max) if input.as_i64().unwrap() > max => Some((
                "less_than_equal",
                format!("Input should be less than or equal to {max}"),
                Some(json!({"le":max})),
            )),
            FieldKind::Array if !input.is_array() => {
                Some(("list_type", "Input should be a valid list".into(), None))
            }
            _ => None,
        };
        if let Some((kind, msg, ctx)) = error {
            let mut error = json!({"type":kind,"loc":loc,"msg":msg,"input":original});
            if let Some(ctx) = ctx {
                error["ctx"] = ctx;
            }
            errors.push(error);
        }
    }
    errors
}
