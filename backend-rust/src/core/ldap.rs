use crate::{
    api::deps::{ApiError, AppState},
    core::{crypto, security::hash_password},
    models::user::{User, UserRole},
    schemas::auth::validation,
};
use ldap3::{Ldap, LdapConnAsync, LdapConnSettings, Scope, SearchEntry};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::FromRow;
use std::time::Duration;
use uuid::Uuid;
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Config {
    pub enabled: bool,
    pub server_uri: String,
    pub start_tls: bool,
    pub verify_tls: bool,
    pub bind_dn: Option<String>,
    #[serde(skip)]
    pub bind_password_encrypted: Option<String>,
    pub user_base_dn: String,
    pub user_filter: String,
    pub email_attribute: String,
    pub group_attribute: String,
    pub admin_group_dn: Option<String>,
    pub editor_group_dn: Option<String>,
    pub viewer_group_dn: Option<String>,
    pub default_role: UserRole,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: false,
            server_uri: String::new(),
            start_tls: false,
            verify_tls: true,
            bind_dn: None,
            bind_password_encrypted: None,
            user_base_dn: String::new(),
            user_filter: "(uid={username})".into(),
            email_attribute: "mail".into(),
            group_attribute: "memberOf".into(),
            admin_group_dn: None,
            editor_group_dn: None,
            viewer_group_dn: None,
            default_role: UserRole::Viewer,
        }
    }
}
impl Config {
    pub fn read(&self) -> Value {
        let mut v = serde_json::to_value(self).unwrap();
        v["bind_password_set"] = json!(self
            .bind_password_encrypted
            .as_ref()
            .is_some_and(|s| !s.is_empty()));
        v
    }
}
pub async fn config(state: &AppState) -> Result<Option<Config>, ApiError> {
    sqlx::query_as("SELECT enabled,server_uri,start_tls,verify_tls,bind_dn,bind_password_encrypted,user_base_dn,user_filter,email_attribute,group_attribute,admin_group_dn,editor_group_dn,viewer_group_dn,default_role FROM ldap_config WHERE id=1").fetch_optional(&state.pool).await.map_err(|e|ApiError::internal(e.to_string()))
}
pub async fn save(state: &AppState, v: Value) -> Result<Config, ApiError> {
    let mut merged = serde_json::to_value(Config::default()).unwrap();
    for (k, value) in v
        .as_object()
        .ok_or_else(|| validation("Input should be an object"))?
    {
        merged[k] = value.clone();
    }
    for k in ["enabled", "server_uri", "user_base_dn"] {
        if v.get(k).is_none() {
            return Err(validation(format!("{k}: Field required")));
        }
    }
    let mut c: Config = serde_json::from_value(merged).map_err(|e| validation(e.to_string()))?;
    if !(c.server_uri.starts_with("ldap://") || c.server_uri.starts_with("ldaps://")) {
        return Err(validation("server_uri must start with ldap:// or ldaps://"));
    }
    for (s, min, max) in [
        (&c.server_uri, 1, 255),
        (&c.user_base_dn, 1, 512),
        (&c.user_filter, 1, 512),
        (&c.email_attribute, 0, 64),
        (&c.group_attribute, 0, 64),
    ] {
        if s.chars().count() < min || s.chars().count() > max {
            return Err(validation("Invalid LDAP field length"));
        }
    }
    if !c.user_filter.contains("{username}") && !c.user_filter.contains("{email}") {
        return Err(validation("user_filter must contain {username} or {email}"));
    }
    c.bind_password_encrypted = config(state).await?.and_then(|x| x.bind_password_encrypted);
    if let Some(password) = v.get("bind_password").and_then(Value::as_str) {
        c.bind_password_encrypted = if password.is_empty() {
            None
        } else {
            Some(crypto::encrypt_secret(password, &state.settings.jwt_secret))
        };
    }
    sqlx::query("INSERT INTO ldap_config(id,enabled,server_uri,start_tls,verify_tls,bind_dn,bind_password_encrypted,user_base_dn,user_filter,email_attribute,group_attribute,admin_group_dn,editor_group_dn,viewer_group_dn,default_role,created_at,updated_at) VALUES(1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),now()) ON CONFLICT(id) DO UPDATE SET enabled=$1,server_uri=$2,start_tls=$3,verify_tls=$4,bind_dn=$5,bind_password_encrypted=$6,user_base_dn=$7,user_filter=$8,email_attribute=$9,group_attribute=$10,admin_group_dn=$11,editor_group_dn=$12,viewer_group_dn=$13,default_role=$14,updated_at=now()") .bind(c.enabled).bind(&c.server_uri).bind(c.start_tls).bind(c.verify_tls).bind(&c.bind_dn).bind(&c.bind_password_encrypted).bind(&c.user_base_dn).bind(&c.user_filter).bind(&c.email_attribute).bind(&c.group_attribute).bind(&c.admin_group_dn).bind(&c.editor_group_dn).bind(&c.viewer_group_dn).bind(&c.default_role).execute(&state.pool).await.map_err(|e|ApiError::internal(e.to_string()))?;
    Ok(c)
}
async fn connect(c: &Config) -> Result<Ldap, String> {
    let settings = LdapConnSettings::new()
        .set_conn_timeout(Duration::from_secs(5))
        .set_no_tls_verify(!c.verify_tls)
        .set_starttls(c.start_tls && !c.server_uri.starts_with("ldaps://"));
    let (conn, ldap) = LdapConnAsync::with_settings(settings, &c.server_uri)
        .await
        .map_err(|e| e.to_string())?;
    ldap3::drive!(conn);
    Ok(ldap)
}
async fn service(c: &Config, secret: &str) -> Result<Ldap, String> {
    let password = c
        .bind_password_encrypted
        .as_ref()
        .and_then(|p| crypto::decrypt_secret(p, secret));
    if c.bind_dn.as_ref().is_some_and(|s| !s.is_empty()) && password.is_none() {
        return Err("Configured LDAP bind password cannot be decrypted".into());
    }
    let mut ldap = connect(c).await?;
    ldap.with_timeout(Duration::from_secs(5))
        .simple_bind(
            c.bind_dn.as_deref().unwrap_or(""),
            password.as_deref().unwrap_or(""),
        )
        .await
        .map_err(|e| e.to_string())?
        .success()
        .map_err(|e| e.to_string())?;
    Ok(ldap)
}
pub fn lookup_filter(c: &Config, email: &str) -> String {
    let username = email.split('@').next().unwrap_or(email);
    c
        .user_filter
        .replace("{username}", &ldap3::ldap_escape(username))
        .replace("{email}", &ldap3::ldap_escape(email))
}
async fn find(c: &Config, ldap: &mut Ldap, email: &str) -> Result<Option<SearchEntry>, String> {
    let filter = lookup_filter(c, email);
    let (results, _) = ldap
        .with_timeout(Duration::from_secs(5))
        .search(
            &c.user_base_dn,
            Scope::Subtree,
            &filter,
            vec![c.email_attribute.as_str(), c.group_attribute.as_str()],
        )
        .await
        .map_err(|e| e.to_string())?
        .success()
        .map_err(|e| e.to_string())?;
    if results.len() != 1 {
        return Ok(None);
    }
    Ok(results.into_iter().next().map(SearchEntry::construct))
}
fn role(c: &Config, e: &SearchEntry) -> UserRole {
    let groups = entry_values(e, &c.group_attribute);
    for (dn, role) in [
        (&c.admin_group_dn, UserRole::Admin),
        (&c.editor_group_dn, UserRole::Editor),
        (&c.viewer_group_dn, UserRole::Viewer),
    ] {
        if dn.as_ref().is_some_and(|dn| {
            groups
                .iter()
                .any(|g| g.trim().eq_ignore_ascii_case(dn.trim()))
        }) {
            return role;
        }
    }
    c.default_role.clone()
}
async fn user_bind(c: &Config, dn: &str, password: &str) -> Result<(), String> {
    let mut ldap = connect(c).await?;
    ldap.with_timeout(Duration::from_secs(5))
        .simple_bind(dn, password)
        .await
        .map_err(|e| e.to_string())?
        .success()
        .map_err(|e| e.to_string())?;
    let _ = ldap.unbind().await;
    Ok(())
}
pub struct ResolvedEntry(SearchEntry);
impl ResolvedEntry {
    pub fn dn(&self) -> &str {
        &self.0.dn
    }
}
pub async fn resolve(c: &Config, secret: &str, email: &str) -> Result<Option<ResolvedEntry>, String> {
    if !c.enabled {
        return Ok(None);
    }
    let mut ldap = service(c, secret).await?;
    let entry = find(c, &mut ldap, email).await?;
    let _ = ldap.unbind().await;
    Ok(entry.map(ResolvedEntry))
}
pub async fn authenticate_resolved(
    state: &AppState,
    c: &Config,
    entry: ResolvedEntry,
    email: &str,
    password: &str,
) -> Result<Option<User>, ApiError> {
    let entry = entry.0;
    if !c.enabled || password.is_empty() || user_bind(c, &entry.dn, password).await.is_err() {
        return Ok(None);
    }
    let email = entry_values(&entry, &c.email_attribute)
        .first()
        .map(String::as_str)
        .unwrap_or(if email.contains('@') { email } else { "" })
        .trim()
        .to_lowercase();
    if email.is_empty() {
        return Ok(None);
    }
    let role = role(c, &entry);
    let existing = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email=$1")
        .bind(&email)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    if let Some(u) = existing {
        if !u.is_active || u.auth_source != "ldap" {
            return Ok(None);
        }
        return sqlx::query_as("UPDATE users SET role=$2,updated_at=now() WHERE id=$1 RETURNING *")
            .bind(u.id)
            .bind(role)
            .fetch_one(&state.pool)
            .await
            .map(Some)
            .map_err(|e| ApiError::internal(e.to_string()));
    }
    let hash = hash_password(&Uuid::new_v4().to_string()).map_err(ApiError::internal)?;
    sqlx::query_as("INSERT INTO users(id,email,password_hash,role,is_active,auth_source,preferences,created_at,updated_at) VALUES($1,$2,$3,$4,true,'ldap','{}',now(),now()) RETURNING *").bind(Uuid::new_v4()).bind(email).bind(hash).bind(role).fetch_one(&state.pool).await.map(Some).map_err(|e|ApiError::internal(e.to_string()))
}
pub async fn test(state: &AppState, payload: Value) -> Result<Value, ApiError> {
    let Some(c) = config(state).await? else {
        return Ok(json!({"ok":false,"message":"LDAP settings have not been saved"}));
    };
    let result = async {
        let mut ldap = service(&c, &state.settings.jwt_secret).await?;
        let username = payload
            .get("username")
            .and_then(Value::as_str)
            .unwrap_or("");
        if username.is_empty() {
            let _ = ldap.unbind().await;
            return Ok("Service bind succeeded".to_owned());
        }
        let entry = find(&c, &mut ldap, username).await?;
        let _ = ldap.unbind().await;
        let entry = entry.ok_or("User search returned zero or multiple entries")?;
        if let Some(password) = payload
            .get("password")
            .and_then(Value::as_str)
            .filter(|p| !p.is_empty())
        {
            user_bind(&c, &entry.dn, password).await?;
        }
        Ok::<_, String>(format!(
            "Found {}; resolved role: {}",
            entry.dn,
            role(&c, &entry).as_str()
        ))
    }
    .await;
    Ok(match result {
        Ok(message) => json!({"ok":true,"message":message}),
        Err(message) => json!({"ok":false,"message":message}),
    })
}
fn entry_values<'a>(entry: &'a SearchEntry, attribute: &str) -> &'a [String] {
    entry
        .attrs
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(attribute))
        .map(|(_, values)| values.as_slice())
        .unwrap_or(&[])
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roles_follow_case_insensitive_group_priority() {
        let c = Config {
            admin_group_dn: Some("CN=Admins,DC=example".into()),
            editor_group_dn: Some("CN=Editors,DC=example".into()),
            ..Config::default()
        };
        let e = SearchEntry {
            dn: "uid=test,dc=example".into(),
            attrs: std::collections::HashMap::from([(
                "MEMBEROF".into(),
                vec![
                    " cn=admins,dc=example ".into(),
                    "CN=Editors,DC=example".into(),
                ],
            )]),
            bin_attrs: std::collections::HashMap::new(),
        };
        assert_eq!(role(&c, &e), UserRole::Admin);
        assert_eq!(role(&Config::default(), &e), UserRole::Viewer);
    }
    #[test]
    fn lookup_identity_follows_configured_username_and_email_substitutions() {
        let username = Config::default();
        assert_eq!(lookup_filter(&username, "alice@one.example"), lookup_filter(&username, "alice@two.example"));
        assert_ne!(lookup_filter(&username, "alice@one.example"), lookup_filter(&username, "bob@one.example"));
        let email = Config { user_filter: "(mail={email})".into(), ..Config::default() };
        assert_ne!(lookup_filter(&email, "alice@one.example"), lookup_filter(&email, "alice@two.example"));
        let both = Config { user_filter: "(&(uid={username})(mail={email}))".into(), ..Config::default() };
        assert_eq!(lookup_filter(&both, "alice@example.com"), "(&(uid=alice)(mail=alice@example.com))");
        assert!(!lookup_filter(&username, "a*)(uid=*)@example.com").contains("(uid=*)"));
    }
}
