use axum::{extract::{Path, Query, State}, http::{header, StatusCode}, response::{IntoResponse, Response}, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;
use crate::api::deps::{AppState, ApiError, Viewer, Csrf};
use super::{db_error, setting};
use crate::api::inventory::export::csv_text;

const INVENTORY: &str = "NOT jsonb_path_exists(v.tags, '$[*] ? (@ like_regex \"^(template|backup)$\" flag \"i\")')";
const REPORTS: &[(&str, &str)] = &[
    ("linux", "v.os_family='linux'"), ("windows", "v.os_family='windows'"),
    ("production", "v.environment='production'"), ("monitoring", "v.monitoring_enabled"),
    ("applications", "EXISTS(SELECT 1 FROM vm_applications a WHERE a.vm_id=v.id)"),
    ("owner", "v.business_owner IS NOT NULL AND v.business_owner<>''"),
    ("pmp_access", "v.pmp_enabled"),
    ("decommission", "v.decommission_date IS NOT NULL AND v.status<>'decommissioned'"),
];
const CSV_COLUMNS: &[&str] = &["name","external_id","sr_id","fqdn","platform","cluster","node","environment","status","criticality","cpu_cores","memory_mb","os_family","os_distribution","os_version","business_owner","technical_owner","pmp_enabled","monitoring_enabled","last_patch_date","last_vuln_scan_date","decommission_date","description","tags","applications"];

async fn values(pool: &sqlx::PgPool, query: String) -> Result<Vec<Value>, ApiError> {
    sqlx::query_scalar(sqlx::AssertSqlSafe(query)).fetch_all(pool).await.map_err(db_error)
}

pub async fn summary(State(state): State<AppState>, _: Viewer) -> Result<Json<Value>, ApiError> {
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM vms").fetch_one(&state.pool).await.map_err(db_error)?;
    let mut counts = serde_json::Map::new();
    for (name, condition) in REPORTS {
        let column = if *name == "owner" { "count(DISTINCT v.business_owner)" } else { "count(*)" };
        let n: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT {column} FROM vms v WHERE {condition}"))).fetch_one(&state.pool).await.map_err(db_error)?;
        counts.insert((*name).into(), json!(n));
    }
    Ok(Json(json!({"total_vms":total,"counts":counts})))
}

#[derive(Deserialize)]
pub struct Format { #[serde(default="csv_format")] format: String }
fn csv_format() -> String { "csv".into() }
fn cell(value: &Value) -> String {
    match value { Value::Null => String::new(), Value::String(s) => s.clone(), Value::Bool(b) => if *b { "True".into() } else { "False".into() }, other => other.to_string() }
}
fn report_csv(rows: &[Value]) -> Result<Vec<u8>, ApiError> {
    let mut writer=csv::WriterBuilder::new().terminator(csv::Terminator::CRLF).from_writer(Vec::new());
    writer.write_record(CSV_COLUMNS).map_err(|e|ApiError::internal(e.to_string()))?;
    for row in rows {
        let cells = CSV_COLUMNS.iter().map(|col| match *col {
            "tags" => row[*col].as_array().map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(",")).unwrap_or_default(),
            "monitoring_enabled"|"pmp_enabled" => if row[*col].as_bool().unwrap_or(false) { "Yes".into() } else { "No".into() },
            _ => cell(&row[*col]),
        }).map(csv_text);
        writer.write_record(cells).map_err(|e|ApiError::internal(e.to_string()))?;
    }
    writer.into_inner().map_err(|e|ApiError::internal(e.to_string()))
}
pub async fn report(State(state): State<AppState>, _: Viewer, Path(name): Path<String>, Query(format): Query<Format>) -> Result<Response, ApiError> {
    if format.format != "csv" { return Err(ApiError::validation(vec![json!({"type":"string_pattern_mismatch","loc":["query","format"],"msg":"String should match pattern '^csv$'","input":format.format,"ctx":{"pattern":"^csv$"}})])); }
    let condition = REPORTS.iter().find(|(key,_)| *key==name).map(|(_,cond)| *cond).ok_or_else(|| ApiError::not_found(format!("Unknown report '{name}'. Available: {}", REPORTS.iter().map(|(key,_)| *key).collect::<Vec<_>>().join(", "))))?;
    let order = match name.as_str() { "owner" => "v.business_owner,v.name", "decommission" => "v.decommission_date,v.name", _ => "v.name" };
    let rows = values(&state.pool, format!("SELECT to_jsonb(v) || jsonb_build_object('applications',COALESCE((SELECT string_agg(a.app_name,',' ORDER BY a.app_name) FROM vm_applications a WHERE a.vm_id=v.id),'')) FROM vms v WHERE {condition} ORDER BY {order}")).await?;
    let bytes=report_csv(&rows)?;
    Ok(([(header::CONTENT_TYPE,"text/csv".to_owned()),(header::CONTENT_DISPOSITION,format!("attachment; filename=\"{name}.csv\""))],bytes).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn focused_report_does_not_emit_formula_cells() {
        let rows = vec![json!({
            "name": "  =HYPERLINK(\"https://example.invalid\")",
            "tags": ["+SUM(1,1)"],
            "applications": "@SUM(1,1)"
        })];
        let bytes = report_csv(&rows).unwrap();
        let mut reader = csv::Reader::from_reader(bytes.as_slice());
        let row = reader.records().next().unwrap().unwrap();
        assert_eq!(&row[0], "'  =HYPERLINK(\"https://example.invalid\")");
        assert_eq!(&row[23], "'+SUM(1,1)");
        assert_eq!(&row[24], "'@SUM(1,1)");
    }
}

pub async fn dashboard(State(state): State<AppState>, _: Viewer) -> Result<Json<Value>,ApiError> {
    let mut result: Value = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(r#"SELECT jsonb_build_object(
      'total',count(*),'linux',count(*) FILTER(WHERE v.os_family='linux'),'windows',count(*) FILTER(WHERE v.os_family='windows'),
      'production',count(*) FILTER(WHERE v.environment='production'),'development',count(*) FILTER(WHERE v.environment='development'),
      'test_uat',count(*) FILTER(WHERE v.environment IN('testing','uat')),'powered_off',count(*) FILTER(WHERE v.status='powered_off'),
      'without_monitoring',count(*) FILTER(WHERE NOT v.monitoring_enabled),
      'without_applications',count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM vm_applications a WHERE a.vm_id=v.id)),
      'total_vcpu',COALESCE(sum(v.cpu_cores),0),'total_memory_gb',COALESCE(sum(v.memory_mb),0)/1024.0,
      'total_disk_gb',COALESCE((SELECT sum(d.size_gb) FROM vm_disks d JOIN vms v ON v.id=d.vm_id WHERE {INVENTORY}),0))
      FROM vms v WHERE {INVENTORY}"#))).fetch_one(&state.pool).await.map_err(db_error)?;
    result["total_disk_gb"] = json!(result["total_disk_gb"].as_f64().unwrap_or(0.0));
    for field in ["status","environment","criticality","os_family"] {
        let grouped: Value = sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT COALESCE(jsonb_object_agg(k,n),'{{}}'::jsonb) FROM (SELECT v.{field}::text k,count(*) n FROM vms v WHERE {INVENTORY} AND v.{field} IS NOT NULL GROUP BY v.{field}) x"))).fetch_one(&state.pool).await.map_err(db_error)?;
        result[format!("by_{field}")] = grouped;
    }
    let since="COALESCE((SELECT max(a.changed_at) FROM audit_log a WHERE a.vm_id=v.id AND a.field_name='status' AND a.new_value='powered_off'),v.created_at)";
    let alerts = [
        ("shutdown_stale", format!("v.status='powered_off' AND {since}<=now()-interval '90 days'"), format!("floor(extract(epoch FROM(now()-{since}))/86400)"), since.to_owned(),"NULL::text".to_owned()),
        ("decommission_overdue", "v.decommission_date<=CURRENT_DATE AND v.status<>'decommissioned'".into(), "CURRENT_DATE-v.decommission_date".into(),"v.decommission_date".into(),"NULL::text".into()),
        ("missing_ip", "NOT EXISTS(SELECT 1 FROM vm_networks n WHERE n.vm_id=v.id)".into(),"0".into(),"v.name".into(),"NULL::text".into()),
        ("duplicate_ip", "v.status<>'decommissioned' AND EXISTS(SELECT 1 FROM vm_networks n JOIN vm_networks n2 ON n2.ip_address=n.ip_address AND n2.role=n.role AND n2.vm_id<>n.vm_id JOIN vms other ON other.id=n2.vm_id WHERE n.vm_id=v.id AND other.status<>'decommissioned' AND NOT jsonb_path_exists(other.tags,'$[*] ? (@ like_regex \"^(template|backup)$\" flag \"i\")'))".into(), "0".into(),"v.name".into(), "(SELECT n.ip_address FROM vm_networks n WHERE n.vm_id=v.id AND EXISTS(SELECT 1 FROM vm_networks n2 JOIN vms v ON v.id=n2.vm_id WHERE n2.ip_address=n.ip_address AND n2.role=n.role AND n2.vm_id<>n.vm_id AND v.status<>'decommissioned' AND NOT jsonb_path_exists(v.tags,'$[*] ? (@ like_regex \"^(template|backup)$\" flag \"i\")')) ORDER BY n.sort_order,n.id LIMIT 1)".into()),
    ];
    for (key,condition,days,order,detail) in alerts {
        result[key]=json!(values(&state.pool,format!("SELECT jsonb_build_object('id',v.id,'name',v.name,'environment',v.environment,'days',({days})::int,'detail',{detail}) FROM vms v WHERE {INVENTORY} AND {condition} ORDER BY {order} LIMIT 50")).await?);
    }
    Ok(Json(result))
}

async fn notify_days(state: &AppState) -> Result<i32,ApiError> { Ok(setting(&state.pool,"decommission_notify_days","30").await?.parse().unwrap_or(30)) }
pub async fn due(State(state): State<AppState>, user: Viewer) -> Result<Json<Value>,ApiError> {
    let days=notify_days(&state).await?;
    let rows: Vec<Value> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT jsonb_build_object('vm_id',v.id,'name',v.name,'decommission_date',v.decommission_date,'days_remaining',v.decommission_date-CURRENT_DATE,'unread',a.acked_date IS DISTINCT FROM v.decommission_date) FROM vms v LEFT JOIN decommission_acks a ON a.vm_id=v.id AND a.user_id=$1 WHERE v.decommission_date<=CURRENT_DATE+$2 AND v.status<>'decommissioned' AND {INVENTORY} ORDER BY v.decommission_date")))
        .bind(user.0.id).bind(days).fetch_all(&state.pool).await.map_err(db_error)?;
    Ok(Json(json!(rows)))
}
#[derive(Deserialize)]
pub struct Ack { vm_ids: Option<Vec<Uuid>> }
pub async fn ack(State(state): State<AppState>, user: Viewer, _: Csrf, Json(payload): Json<Ack>) -> Result<Response,ApiError> {
    let days=notify_days(&state).await?;
    let mut tx=state.pool.begin().await.map_err(db_error)?;
    let ids: Vec<(Uuid,chrono::NaiveDate)> = sqlx::query_as(sqlx::AssertSqlSafe(format!("SELECT id,decommission_date FROM vms v WHERE decommission_date<=CURRENT_DATE+$1 AND status<>'decommissioned' AND {INVENTORY} AND ($2::uuid[] IS NULL OR id=ANY($2))")))
        .bind(days).bind(payload.vm_ids).fetch_all(&mut *tx).await.map_err(db_error)?;
    for (id,date) in ids { sqlx::query("INSERT INTO decommission_acks(id,user_id,vm_id,acked_date,created_at,updated_at) VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT(user_id,vm_id) DO UPDATE SET acked_date=EXCLUDED.acked_date,updated_at=now()")
        .bind(Uuid::new_v4()).bind(user.0.id).bind(id).bind(date).execute(&mut *tx).await.map_err(db_error)?; }
    tx.commit().await.map_err(db_error)?;
    Ok((StatusCode::NO_CONTENT, [(header::CONTENT_TYPE, "application/json")]).into_response())
}
pub async fn duplicate_ips(State(state): State<AppState>, _: Viewer) -> Result<Json<Value>,ApiError> {
    let rows=values(&state.pool,format!("WITH active AS(SELECT n.ip_address,v.id,v.name FROM vm_networks n JOIN vms v ON v.id=n.vm_id WHERE v.status='running' AND {INVENTORY}), duplicates AS(SELECT ip_address,count(*) occurrences FROM active GROUP BY ip_address HAVING count(*)>1) SELECT jsonb_build_object('ip_address',d.ip_address,'occurrences',d.occurrences,'vms',(SELECT jsonb_agg(jsonb_build_object('vm_id',a.id,'name',a.name) ORDER BY a.name) FROM (SELECT DISTINCT id,name FROM active WHERE ip_address=d.ip_address) a)) FROM duplicates d ORDER BY d.ip_address")).await?;
    Ok(Json(json!(rows)))
}

