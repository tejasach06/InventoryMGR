use crate::{
    api::deps::{ApiError, AppState, AuthUser, Csrf},
    models::user::User,
    schemas::auth::validation,
};
use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
const ACCENTS: &[&str] = &["orange", "blue", "violet", "emerald", "rose", "amber"];
const COLUMNS: &[(&str, bool, i64)] = &[
    ("name", true, 0),
    ("platform", true, 1),
    ("cluster", true, 2),
    ("status", true, 3),
    ("resources", true, 4),
    ("criticality", true, 5),
    ("private_ip", true, 6),
    ("updated_at", true, 7),
    ("fqdn", false, 8),
    ("environment", false, 9),
    ("vm_type", false, 11),
    ("datacenter", false, 12),
    ("node", false, 13),
    ("os_family", false, 14),
    ("owner", false, 15),
    ("business_owner", false, 16),
    ("technical_owner", false, 17),
    ("pmp_enabled", false, 18),
    ("monitoring_enabled", false, 19),
    ("backup_enabled", false, 20),
    ("ha_enabled", false, 21),
    ("health_score", false, 22),
    ("tags", false, 23),
    ("created_at", false, 24),
    ("public_ip", false, 25),
    ("backup_ip", false, 26),
];
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/user/accent", get(accent).put(set_accent))
        .route("/user/preferences/{page}", get(columns).put(set_columns))
}
#[derive(Deserialize, Serialize)]
struct Accent {
    accent: String,
}
#[derive(Clone, Deserialize, Serialize)]
struct Column {
    key: String,
    visible: bool,
    order: i64,
}
#[derive(Deserialize, Serialize)]
struct Columns {
    columns: Vec<Column>,
}
async fn accent(AuthUser(u): AuthUser) -> Json<Accent> {
    let accent = u
        .preferences
        .get("accent_color")
        .and_then(Value::as_str)
        .filter(|v| ACCENTS.contains(v))
        .unwrap_or("orange")
        .to_owned();
    Json(Accent { accent })
}
async fn store(s: &AppState, u: &User, key: &str, value: Value) -> Result<(), ApiError> {
    sqlx::query("UPDATE users SET preferences=jsonb_set(COALESCE(preferences,'{}'::jsonb),ARRAY[$2]::text[],$3::jsonb),updated_at=now() WHERE id=$1").bind(u.id).bind(key).bind(value).execute(&s.pool).await.map_err(|e|ApiError::internal(e.to_string()))?;
    Ok(())
}
async fn set_accent(
    State(s): State<AppState>,
    AuthUser(u): AuthUser,
    _csrf: Csrf,
    crate::api::deps::ValidatedJson(p): crate::api::deps::ValidatedJson<Accent>,
) -> Result<Json<Accent>, ApiError> {
    if !ACCENTS.contains(&p.accent.as_str()) {
        return Err(validation("Invalid accent"));
    }
    store(&s, &u, "accent_color", json!(p.accent)).await?;
    Ok(Json(p))
}
async fn columns(
    Path(page): Path<String>,
    AuthUser(u): AuthUser,
) -> Result<Json<Columns>, ApiError> {
    let saved = u
        .preferences
        .get(format!("columns_{page}"))
        .and_then(Value::as_array);
    let mut cols = if let Some(saved) = saved.filter(|s| !s.is_empty()) {
        serde_json::from_value::<Vec<Column>>(json!(saved))
            .map_err(|e| ApiError::internal(e.to_string()))?
    } else {
        return Ok(Json(Columns {
            columns: COLUMNS
                .iter()
                .map(|(k, v, o)| Column {
                    key: k.to_string(),
                    visible: *v,
                    order: *o,
                })
                .collect(),
        }));
    };
    let mut seen = HashSet::new();
    cols.retain_mut(|c| {
        c.key = match c.key.as_str() {
            "ip_address" => "private_ip".into(),
            "os" => "os_family".into(),
            _ => c.key.clone(),
        };
        seen.insert(c.key.clone())
    });
    let mut order = cols.iter().map(|c| c.order).max().unwrap_or(-1) + 1;
    for (k, _, _) in COLUMNS {
        if !seen.contains(*k) {
            cols.push(Column {
                key: k.to_string(),
                visible: false,
                order,
            });
            order += 1;
        }
    }
    Ok(Json(Columns { columns: cols }))
}
async fn set_columns(
    State(s): State<AppState>,
    AuthUser(u): AuthUser,
    _csrf: Csrf,
    Path(page): Path<String>,
    crate::api::deps::ValidatedJson(p): crate::api::deps::ValidatedJson<Columns>,
) -> Result<Json<Columns>, ApiError> {
    let mut seen = HashSet::new();
    for c in &p.columns {
        if !COLUMNS.iter().any(|(k, _, _)| *k == c.key)
            && !matches!(c.key.as_str(), "ip_address" | "os")
        {
            return Err(validation(format!("Unknown column key: {}", c.key)));
        }
        if !seen.insert(&c.key) {
            return Err(validation(format!("Duplicate column key: {}", c.key)));
        }
    }
    store(&s, &u, &format!("columns_{page}"), json!(p.columns)).await?;
    Ok(Json(p))
}
impl crate::api::deps::JsonSchema for Accent {
    const FIELDS: &'static [(&'static str, bool, crate::api::deps::FieldKind)] =
        &[("accent", true, crate::api::deps::FieldKind::Accent)];
}
impl crate::api::deps::JsonSchema for Columns {
    const FIELDS: &'static [(&'static str, bool, crate::api::deps::FieldKind)] =
        &[("columns", true, crate::api::deps::FieldKind::Array)];
    fn extra_errors(v: &mut Value) -> Vec<Value> {
        let mut errors = Vec::new();
        for (i, col) in v["columns"].as_array_mut().unwrap().iter_mut().enumerate() {
            errors.extend(crate::api::deps::validate_fields(
                col,
                &[
                    ("key", true, crate::api::deps::FieldKind::String),
                    ("visible", true, crate::api::deps::FieldKind::Bool),
                    (
                        "order",
                        true,
                        crate::api::deps::FieldKind::Int(i64::MIN, i64::MAX),
                    ),
                ],
                &[],
                &[json!("body"), json!("columns"), json!(i)],
            ));
        }
        errors
    }
}
