use crate::{core::error::Error, models::user::{User, UserRole}};
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
pub fn email(value: &str) -> Result<String, Error> {
    if value.len() > 254 {
        return Err(Error::Invalid("Email must be at most 254 bytes".into()));
    }
    let value = value.trim().to_lowercase();
    static RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"^[^@\s]+@[^@\s]+\.[^@\s]+$").unwrap());
    if value.len() > 254 || !RE.is_match(&value) {
        return Err(Error::Invalid("must be a valid email address".into()));
    }
    Ok(value)
}
pub fn password(value: &str) -> Result<(), Error> {
    let length = value.chars().count();
    if length > 1024 {
        return Err(Error::Invalid("String should have at most 1024 characters".into()));
    }
    if length < 8 {
        return Err(Error::Invalid("String should have at least 8 characters".into()));
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
