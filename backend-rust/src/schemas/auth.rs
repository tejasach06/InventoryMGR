use crate::{
    api::deps::ApiError,
    models::user::{User, UserRole},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub remember: bool,
}
#[derive(Deserialize)]
pub struct SetupAdminRequest {
    pub email: String,
    pub password: String,
}
#[derive(Serialize)]
pub struct SetupStatusResponse {
    pub setup_required: bool,
}
#[derive(Serialize)]
pub struct LoginResponse {
    pub user: UserRead,
}
#[derive(Serialize)]
pub struct UserRead {
    pub id: Uuid,
    pub email: String,
    pub role: UserRole,
    pub is_active: bool,
    pub auth_source: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
impl From<User> for UserRead {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            email: u.email,
            role: u.role,
            is_active: u.is_active,
            auth_source: u.auth_source,
            created_at: u.created_at,
            updated_at: u.updated_at,
        }
    }
}
pub fn email(value: &str) -> Result<String, ApiError> {
    if value.len() > 254 {
        return Err(validation("Email must be at most 254 bytes"));
    }
    let value = value.trim().to_lowercase();
    static RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"^[^@\s]+@[^@\s]+\.[^@\s]+$").unwrap());
    if value.len() > 254 || !RE.is_match(&value) {
        return Err(validation("must be a valid email address"));
    }
    Ok(value)
}
pub fn validation(message: impl Into<String>) -> ApiError {
    ApiError::new(axum::http::StatusCode::UNPROCESSABLE_ENTITY, message)
}
pub fn password(value: &str) -> Result<(), ApiError> {
    let length = value.chars().count();
    if length > 1024 {
        return Err(validation("String should have at most 1024 characters"));
    }
    if length < 8 {
        return Err(validation("String should have at least 8 characters"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn login_uses_email_and_defaults_remember() {
        let input: LoginRequest = serde_json::from_value(
            serde_json::json!({"email":"test@example.org","password":"password"}),
        )
        .unwrap();
        assert!(!input.remember);
        assert_eq!(email(" TEST@Example.ORG ").unwrap(), "test@example.org");
        assert!(email("test").is_err());
        assert!(serde_json::from_value::<LoginRequest>(
            serde_json::json!({"username":"old","password":"password"})
        )
        .is_err());
    }
    #[test]
    fn setup_requires_source_fields_and_password_length() {
        assert!(serde_json::from_value::<SetupAdminRequest>(
            serde_json::json!({"email":"test@example.org","password":"password"})
        )
        .is_ok());
        assert!(password("1234567").is_err());
        assert!(password("12345678").is_ok());
        assert_eq!(
            serde_json::to_value(SetupStatusResponse {
                setup_required: true
            })
            .unwrap(),
            serde_json::json!({"setup_required":true})
        );
    }
}
impl crate::api::deps::JsonSchema for LoginRequest {
    const FIELDS: &'static [(&'static str, bool, crate::api::deps::FieldKind)] = &[
        ("email", true, crate::api::deps::FieldKind::Email),
        ("password", true, crate::api::deps::FieldKind::StrLen(0, 1024)),
        ("remember", false, crate::api::deps::FieldKind::Bool),
    ];
}
impl crate::api::deps::JsonSchema for SetupAdminRequest {
    const FIELDS: &'static [(&'static str, bool, crate::api::deps::FieldKind)] = &[
        ("email", true, crate::api::deps::FieldKind::Email),
        ("password", true, crate::api::deps::FieldKind::Password),
    ];
}
