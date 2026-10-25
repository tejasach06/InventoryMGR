use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

const SESSION_TTL_MINUTES: i64 = 12 * 60;
const REFRESH_TTL_MINUTES: i64 = 7 * 24 * 60;

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionClaims {
    pub sub: String,
    pub role: String,
    pub exp: i64,
    pub iat: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<String>,
    pub credential: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshClaims {
    pub sub: String,
    pub r#type: String,
    pub persist: bool,
    pub exp: i64,
    pub iat: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<String>,
    pub credential: String,
}

pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(65536, 3, 4, None).expect("valid Argon2 parameters"),
    );
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let parsed_hash = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

fn credential_mac(user_id: &str, auth_source: &str, password_hash: &str, secret: &str) -> HmacSha256 {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("valid HMAC key");
    mac.update(b"inventorymgr:credential:v1\0");
    for value in [user_id, auth_source, password_hash] {
        mac.update(&(value.len() as u64).to_be_bytes());
        mac.update(value.as_bytes());
    }
    mac
}

pub fn credential_fingerprint(
    user_id: &str, auth_source: &str, password_hash: &str, secret: &str,
) -> String {
    hex::encode(credential_mac(user_id, auth_source, password_hash, secret).finalize().into_bytes())
}

pub fn verify_credential_fingerprint(
    provided: &str, user_id: &str, auth_source: &str, password_hash: &str, secret: &str,
) -> bool {
    let Ok(bytes) = hex::decode(provided) else { return false };
    credential_mac(user_id, auth_source, password_hash, secret).verify_slice(&bytes).is_ok()
}

pub fn derive_csrf_token(session_token: &str, secret: &str) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(session_token.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

pub fn verify_csrf_token(provided: &str, session_token: &str, secret: &str) -> bool {
    let Ok(bytes) = hex::decode(provided) else {
        return false;
    };
    if provided.len() != 64 || provided.bytes().any(|b| b.is_ascii_uppercase()) {
        return false;
    }
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("valid HMAC key");
    mac.update(session_token.as_bytes());
    mac.verify_slice(&bytes).is_ok()
}

pub fn create_session_token(
    user_id: &str,
    role: &str,
    generation: &str,
    credential: &str,
    secret: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let expires = now + Duration::minutes(SESSION_TTL_MINUTES);
    let claims = SessionClaims {
        sub: user_id.to_string(),
        role: role.to_string(),
        exp: expires.timestamp(),
        iat: now.timestamp(),
        generation: Some(generation.to_owned()),
        credential: credential.to_owned(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn decode_session_token(
    token: &str,
    secret: &str,
) -> Result<SessionClaims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::default();
    validation.leeway = 0;
    decode::<SessionClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map(|data| data.claims)
}

pub fn create_refresh_token(
    user_id: &str,
    persist: bool,
    generation: &str,
    credential: &str,
    secret: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let expires = now + Duration::minutes(REFRESH_TTL_MINUTES);
    let claims = RefreshClaims {
        sub: user_id.to_string(),
        r#type: "refresh".to_string(),
        persist,
        exp: expires.timestamp(),
        iat: now.timestamp(),
        generation: Some(generation.to_owned()),
        credential: credential.to_owned(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn decode_refresh_token(
    token: &str,
    secret: &str,
) -> Result<RefreshClaims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::default();
    validation.leeway = 0;
    decode::<RefreshClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map(|data| data.claims)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn passwords_match_source_parameters() {
        let hash = hash_password("source-parity-password").unwrap();
        assert!(hash.starts_with("$argon2id$v=19$m=65536,t=3,p=4$"));
        assert!(verify_password("source-parity-password", &hash));
        assert!(!verify_password("wrong", &hash));
    }
    #[test]
    fn csrf_requires_exact_signed_value() {
        let token = derive_csrf_token("session", "secret");
        assert!(verify_csrf_token(&token, "session", "secret"));
        assert!(!verify_csrf_token(
            &format!(" {token}"),
            "session",
            "secret"
        ));
        assert!(!verify_csrf_token(
            &token.to_uppercase(),
            "session",
            "secret"
        ));
        assert!(!verify_csrf_token(&token, "other-session", "secret"));
    }
    #[test]
    fn session_carries_generation_and_rejects_unbound_legacy_claims() {
        let token = create_session_token("user", "admin", "generation", "credential", "secret").unwrap();
        let claims = decode_session_token(&token, "secret").unwrap();
        assert_eq!(claims.generation.as_deref(), Some("generation"));
        assert_eq!(claims.exp - claims.iat, 43200);
        let legacy = serde_json::json!({"sub":"user","role":"admin","iat":Utc::now().timestamp(),"exp":Utc::now().timestamp()+43200});
        let token = encode(&Header::default(), &legacy, &EncodingKey::from_secret(b"secret")).unwrap();
        assert!(decode_session_token(&token, "secret").is_err());
        let legacy = serde_json::json!({"sub":"user","type":"refresh","persist":true,"iat":Utc::now().timestamp(),"exp":Utc::now().timestamp()+604800});
        let token = encode(&Header::default(), &legacy, &EncodingKey::from_secret(b"secret")).unwrap();
        assert!(decode_refresh_token(&token, "secret").is_err());
    }
    #[test]
    fn refresh_keeps_persistence() {
        let token = create_refresh_token("user", true, "generation", "credential", "secret").unwrap();
        let claims = decode_refresh_token(&token, "secret").unwrap();
        assert_eq!(claims.r#type, "refresh");
        assert_eq!(claims.generation.as_deref(), Some("generation"));
        assert!(claims.persist);
        assert_eq!(claims.exp - claims.iat, 604800);
    }
    #[test]
    fn credential_binding_changes_only_with_that_users_credential() {
        let fingerprint = credential_fingerprint("alice", "local", "old-verifier", "secret");
        assert!(verify_credential_fingerprint(&fingerprint, "alice", "local", "old-verifier", "secret"));
        assert!(!verify_credential_fingerprint(&fingerprint, "alice", "local", "new-verifier", "secret"));
        assert!(!verify_credential_fingerprint(&fingerprint, "bob", "local", "old-verifier", "secret"));
        assert!(!verify_credential_fingerprint(&fingerprint, "alice", "ldap", "old-verifier", "secret"));
        assert!(!verify_credential_fingerprint(&fingerprint, "alice", "local", "old-verifier", "other-secret"));
        assert!(!fingerprint.contains("old-verifier"));
    }
}
