use base64::{engine::general_purpose::URL_SAFE, Engine};
use sha2::{Digest, Sha256};
pub fn encrypt_secret(value: &str, secret: &str) -> String {
    fernet::Fernet::new(&URL_SAFE.encode(Sha256::digest(secret.as_bytes())))
        .unwrap()
        .encrypt(value.as_bytes())
}
pub fn decrypt_secret(token: &str, secret: &str) -> Option<String> {
    let f = fernet::Fernet::new(&URL_SAFE.encode(Sha256::digest(secret.as_bytes())))?;
    String::from_utf8(f.decrypt(token).ok()?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_credentials_roundtrip_and_reject_rotated_secret() {
        let token = encrypt_secret("test-bind-password", "test-jwt-secret");
        assert_eq!(
            decrypt_secret(&token, "test-jwt-secret").as_deref(),
            Some("test-bind-password")
        );
        assert_eq!(decrypt_secret(&token, "rotated-secret"), None);
        assert_eq!(decrypt_secret("invalid", "test-jwt-secret"), None);
    }
    #[test]
    fn decrypts_python_fernet_credentials() {
        let token = "gAAAAABqyS3OJSziyd30A6DD4r04EV5KwQLQtpV0OUCLyNz5B3RlEFE16Q07enjxOTKJBTfEj-CdXOY-X9t1IDv1KF4ZEW7heb41ZXMItbwarz5jqKDcTPM=";
        assert_eq!(
            decrypt_secret(token, "source-test-secret").as_deref(),
            Some("source-bind-value")
        );
    }
}
