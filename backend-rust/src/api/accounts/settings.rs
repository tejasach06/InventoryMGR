use crate::{
    api::deps::{Admin, ApiError, AppState, Csrf, Viewer},
    core::ldap,
    schemas::auth::validation,
};
use axum::{extract::State, routing::get, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/settings/options", get(options))
        .route("/settings/app", get(app).patch(update_app))
        .route("/settings/ldap", get(ldap_read).put(ldap_save))
        .route("/settings/ldap/test", axum::routing::post(ldap_test))
}
async fn options(State(s): State<AppState>, _: Viewer) -> Result<Json<Value>, ApiError> {
    let mut v = json!({"cpu":[],"datacenter":[],"disk":[],"os":[],"cluster":[],"os_by_family":{"windows":[],"linux":[]}});
    let rows=sqlx::query("SELECT category::text AS category,value,family::text AS family FROM dropdown_options ORDER BY category,value").fetch_all(&s.pool).await.map_err(|e|ApiError::internal(e.to_string()))?;
    for r in rows {
        let c: String = r.get("category");
        let value: String = r.get("value");
        if let Some(a) = v.get_mut(&c).and_then(Value::as_array_mut) {
            a.push(json!(value));
        }
        if c == "os" {
            if let Some(f) = r.get::<Option<String>, _>("family") {
                if let Some(a) = v["os_by_family"].get_mut(f).and_then(Value::as_array_mut) {
                    a.push(json!(value));
                }
            }
        }
    }
    Ok(Json(v))
}
async fn read_int(s: &AppState, key: &str, default: i64) -> Result<i64, ApiError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT value FROM app_settings WHERE key=$1")
            .bind(key)
            .fetch_optional(&s.pool)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?
            .and_then(|v| v.parse().ok())
            .unwrap_or(default),
    )
}
async fn values(s: &AppState) -> Result<Value, ApiError> {
    Ok(
        json!({"decommission_notify_days":read_int(s,"decommission_notify_days",30).await?,"storage_usage_warn_pct":read_int(s,"storage_usage_warn_pct",85).await?}),
    )
}
async fn app(State(s): State<AppState>, _: Admin) -> Result<Json<Value>, ApiError> {
    Ok(Json(values(&s).await?))
}
#[derive(Deserialize)]
struct Update {
    decommission_notify_days: Option<i64>,
    storage_usage_warn_pct: Option<i64>,
}
async fn update_app(
    State(s): State<AppState>,
    _: Admin,
    _csrf: Csrf,
    crate::api::deps::ValidatedJson(p): crate::api::deps::ValidatedJson<Update>,
) -> Result<Json<Value>, ApiError> {
    for (key, value, max) in [
        ("decommission_notify_days", p.decommission_notify_days, 3650),
        ("storage_usage_warn_pct", p.storage_usage_warn_pct, 100),
    ] {
        if let Some(n) = value {
            if n < 1 || n > max {
                return Err(validation(format!("{key} must be between 1 and {max}")));
            }
        }
    }
    for (key, value) in [
        ("decommission_notify_days", p.decommission_notify_days),
        ("storage_usage_warn_pct", p.storage_usage_warn_pct),
    ] {
        if let Some(n) = value {
            sqlx::query("INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2").bind(key).bind(n.to_string()).execute(&s.pool).await.map_err(|e|ApiError::internal(e.to_string()))?;
        }
    }
    Ok(Json(values(&s).await?))
}
async fn ldap_read(State(s): State<AppState>, _: Admin) -> Result<Json<Value>, ApiError> {
    Ok(Json(ldap::config(&s).await?.unwrap_or_default().read()))
}
async fn ldap_save(
    State(s): State<AppState>,
    _: Admin,
    _csrf: Csrf,
    crate::api::deps::ValidatedJson(p): crate::api::deps::ValidatedJson<LdapUpdate>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(ldap::save(&s, p.0).await?.read()))
}
async fn ldap_test(
    State(s): State<AppState>,
    _: Admin,
    _csrf: Csrf,
    crate::api::deps::ValidatedJson(p): crate::api::deps::ValidatedJson<LdapTest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(ldap::test(&s, p.0).await?))
}
impl crate::api::deps::JsonSchema for Update {
    const NULLABLE: &'static [&'static str] =
        &["decommission_notify_days", "storage_usage_warn_pct"];
    const FIELDS: &'static [(&'static str, bool, crate::api::deps::FieldKind)] = &[
        (
            "decommission_notify_days",
            false,
            crate::api::deps::FieldKind::Int(1, 3650),
        ),
        (
            "storage_usage_warn_pct",
            false,
            crate::api::deps::FieldKind::Int(1, 100),
        ),
    ];
}
#[derive(Deserialize)]
#[serde(transparent)]
struct LdapUpdate(Value);
#[derive(Deserialize)]
#[serde(transparent)]
struct LdapTest(Value);
impl crate::api::deps::JsonSchema for LdapTest {
    const NULLABLE: &'static [&'static str] = &["username", "password"];
    const FIELDS: &'static [(&'static str, bool, crate::api::deps::FieldKind)] = &[
        ("username", false, crate::api::deps::FieldKind::String),
        ("password", false, crate::api::deps::FieldKind::String),
    ];
}
impl crate::api::deps::JsonSchema for LdapUpdate {
    const NULLABLE: &'static [&'static str] = &[
        "bind_dn",
        "bind_password",
        "admin_group_dn",
        "editor_group_dn",
        "viewer_group_dn",
    ];
    const FIELDS: &'static [(&'static str, bool, crate::api::deps::FieldKind)] = &[
        ("enabled", true, crate::api::deps::FieldKind::Bool),
        (
            "server_uri",
            true,
            crate::api::deps::FieldKind::StrLen(1, 255),
        ),
        ("start_tls", false, crate::api::deps::FieldKind::Bool),
        ("verify_tls", false, crate::api::deps::FieldKind::Bool),
        ("bind_dn", false, crate::api::deps::FieldKind::String),
        ("bind_password", false, crate::api::deps::FieldKind::String),
        (
            "user_base_dn",
            true,
            crate::api::deps::FieldKind::StrLen(1, 512),
        ),
        (
            "user_filter",
            false,
            crate::api::deps::FieldKind::StrLen(1, 512),
        ),
        (
            "email_attribute",
            false,
            crate::api::deps::FieldKind::StrLen(0, 64),
        ),
        (
            "group_attribute",
            false,
            crate::api::deps::FieldKind::StrLen(0, 64),
        ),
        ("admin_group_dn", false, crate::api::deps::FieldKind::String),
        (
            "editor_group_dn",
            false,
            crate::api::deps::FieldKind::String,
        ),
        (
            "viewer_group_dn",
            false,
            crate::api::deps::FieldKind::String,
        ),
        ("default_role", false, crate::api::deps::FieldKind::Role),
    ];
    fn extra_errors(v: &mut Value) -> Vec<Value> {
        let uri = v["server_uri"].as_str().unwrap_or("");
        let filter = v
            .get("user_filter")
            .and_then(Value::as_str)
            .unwrap_or("(uid={username})");
        let message = if !uri.starts_with("ldap://") && !uri.starts_with("ldaps://") {
            Some("server_uri must start with ldap:// or ldaps://")
        } else if !filter.contains("{username}") && !filter.contains("{email}") {
            Some("user_filter must contain {username} or {email}")
        } else {
            None
        };
        message.map(|m|vec![json!({"type":"value_error","loc":["body"],"msg":format!("Value error, {m}"),"input":v,"ctx":{"error":{}}})]).unwrap_or_default()
    }
}
