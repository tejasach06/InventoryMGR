use axum::{body::Body, extract::{Multipart, Path, State}, http::{header, HeaderValue, StatusCode}, response::{IntoResponse, Response}, Json};
use chrono::{DateTime, Timelike, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{path::{Path as FsPath, PathBuf}, time::Duration};
use tokio::{io::AsyncWriteExt, process::Command};
use uuid::Uuid;
use crate::api::deps::{Admin, ApiError, AppState, Csrf};
use super::{db_error, setting};

const LOCK_KEY: i64 = 8_273_641_905;
const MAX_UPLOAD: u64 = 2 * 1024 * 1024 * 1024;

fn valid_filename(name: &str) -> bool {
    let Some(rest)=name.strip_prefix("inventorymgr-") else { return false; };
    let Some(rest)=rest.strip_suffix(".dump") else { return false; };
    let bytes=rest.as_bytes();
    bytes.len()>17 && bytes.get(8)==Some(&b'T') && bytes.get(15)==Some(&b'Z') && bytes.get(16)==Some(&b'-')
        && bytes[..8].iter().chain(bytes[9..15].iter()).all(u8::is_ascii_digit)
        && bytes[17..].iter().all(|c| c.is_ascii_lowercase() || *c==b'_')
}
async fn directory(state: &AppState) -> Result<PathBuf,ApiError> {
    let path=PathBuf::from(&state.settings.backup_dir);
    tokio::fs::create_dir_all(&path).await.map_err(|e|ApiError::internal(format!("Backup directory {} is not writable: {e}",path.display())))?;
    tokio::fs::canonicalize(path).await.map_err(|e|ApiError::internal(e.to_string()))
}
async fn writable_directory(state: &AppState) -> Result<PathBuf,ApiError> {
    let directory=directory(state).await?;
    let probe=TempFile(directory.join(format!(".write-check-{}",Uuid::new_v4())));
    let file=tokio::fs::OpenOptions::new().write(true).create_new(true).open(&probe.0).await
        .map_err(|e|ApiError::internal(format!("Backup directory {} is not writable. Fix ownership on the host mount or set BACKUP_DIR to a writable path: {e}",directory.display())))?;
    drop(file);
    drop(probe);
    Ok(directory)
}
async fn resolve(state: &AppState,name: &str) -> Result<PathBuf,ApiError> {
    if !valid_filename(name) { return Err(ApiError::not_found("Backup not found")); }
    let path=directory(state).await?.join(name);
    if !tokio::fs::metadata(&path).await.is_ok_and(|m|m.is_file()) { return Err(ApiError::not_found("Backup not found")); }
    Ok(path)
}
async fn files(state: &AppState) -> Result<Vec<Value>,ApiError> {
    let mut directory=tokio::fs::read_dir(directory(state).await?).await.map_err(|e|ApiError::internal(e.to_string()))?;
    let mut files=Vec::new();
    while let Some(entry)=directory.next_entry().await.map_err(|e|ApiError::internal(e.to_string()))? {
        let name=entry.file_name().to_string_lossy().into_owned();
        if !valid_filename(&name) { continue; }
        if let Ok(metadata)=entry.metadata().await { if metadata.is_file() { if let Ok(modified)=metadata.modified() {
            let created: DateTime<Utc>=modified.into();
            files.push(json!({"name":name,"size_bytes":metadata.len(),"created_at":created}));
        } } }
    }
    files.sort_by(|a,b| b["created_at"].as_str().cmp(&a["created_at"].as_str()));
    Ok(files)
}
async fn backup_settings(state: &AppState) -> Result<Value,ApiError> {
    let enabled=matches!(setting(&state.pool,"backup_schedule_enabled","false").await?.trim().to_lowercase().as_str(),"true"|"1"|"yes");
    let hour=setting(&state.pool,"backup_schedule_hour_utc","2").await?.parse::<i64>().ok().filter(|v|(0..=23).contains(v)).unwrap_or(2);
    let retention=setting(&state.pool,"backup_retention","7").await?.parse::<i64>().ok().filter(|v|*v>=1).unwrap_or(7);
    Ok(json!({"enabled":enabled,"hour_utc":hour,"retention":retention}))
}
async fn prune(state: &AppState) -> Result<(),ApiError> {
    let retention=backup_settings(state).await?["retention"].as_u64().unwrap_or(7) as usize;
    let directory=directory(state).await?;
    for entry in files(state).await?.into_iter().skip(retention) { if let Some(name)=entry["name"].as_str() { let _=tokio::fs::remove_file(directory.join(name)).await; } }
    Ok(())
}
fn executable(state: &AppState,command: &str) -> PathBuf { if state.settings.pg_bin_dir.is_empty() { command.into() } else { FsPath::new(&state.settings.pg_bin_dir).join(command) } }
fn stderr_tail(bytes: &[u8]) -> String { String::from_utf8_lossy(bytes).chars().rev().take(2000).collect::<String>().chars().rev().collect() }
async fn run(command: &mut Command,seconds: u64,name: &str) -> Result<std::process::Output,ApiError> {
    command.kill_on_drop(true);
    tokio::time::timeout(Duration::from_secs(seconds),command.output()).await
        .map_err(|_|ApiError::internal(format!("{name} timed out after {seconds} seconds")))?
        .map_err(|e|ApiError::internal(if e.kind()==std::io::ErrorKind::NotFound { format!("{name} not found on system PATH") } else { e.to_string() }))
}
async fn job(state: &AppState,id: Uuid) -> Result<Value,ApiError> {
    sqlx::query_scalar("SELECT to_jsonb(j) FROM backup_jobs j WHERE id=$1").bind(id).fetch_one(&state.pool).await.map_err(db_error)
}
async fn dump(state: &AppState,kind: &str,user: Option<Uuid>) -> Result<Value,ApiError> {
    let now=Utc::now();
    let name=format!("inventorymgr-{}-{kind}.dump",now.format("%Y%m%dT%H%M%SZ"));
    let path=writable_directory(state).await?.join(&name);
    let id=Uuid::new_v4();
    sqlx::query("INSERT INTO backup_jobs(id,kind,status,filename,user_id,started_at) VALUES($1,$2,'running',$3,$4,$5)")
        .bind(id).bind(kind).bind(name).bind(user).bind(now).execute(&state.pool).await.map_err(db_error)?;
    let outcome=run(Command::new(executable(state,"pg_dump")).arg("--format=custom").arg("--no-owner").arg("--no-privileges").arg(format!("--file={}",path.display())).arg(&state.settings.database_url),3600,"pg_dump").await;
    let error=match outcome { Ok(output) if output.status.success()=>None, Ok(output)=>Some({let msg=stderr_tail(&output.stderr); if msg.is_empty(){format!("pg_dump exited with code {}",output.status)}else{msg}}), Err(e)=>Some(e.message) };
    if let Some(message)=error {
        let _=tokio::fs::remove_file(&path).await;
        sqlx::query("UPDATE backup_jobs SET status='failed',error=$2,finished_at=now() WHERE id=$1").bind(id).bind(&message).execute(&state.pool).await.map_err(db_error)?;
        return Err(ApiError::internal(message));
    }
    let size=tokio::fs::metadata(path).await.map_err(|e|ApiError::internal(e.to_string()))?.len() as i64;
    sqlx::query("UPDATE backup_jobs SET status='success',size_bytes=$2,finished_at=now() WHERE id=$1").bind(id).bind(size).execute(&state.pool).await.map_err(db_error)?;
    job(state,id).await
}
pub async fn overview(State(state): State<AppState>, _: Admin) -> Result<Json<Value>,ApiError> {
    let jobs: Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(j) FROM backup_jobs j ORDER BY started_at DESC LIMIT 20").fetch_all(&state.pool).await.map_err(db_error)?;
    Ok(Json(json!({"backups":files(&state).await?,"jobs":jobs,"settings":backup_settings(&state).await?})))
}
pub async fn create(State(state): State<AppState>,user: Admin, _: Csrf) -> Result<(StatusCode,Json<Value>),ApiError> {
    let result=dump(&state,"manual",Some(user.0.id)).await?;
    prune(&state).await?;
    Ok((StatusCode::CREATED,Json(result)))
}
pub async fn download(State(state): State<AppState>,_: Admin,Path(name): Path<String>) -> Result<Response,ApiError> {
    let path=resolve(&state,&name).await?;
    let file=tokio::fs::File::open(path).await.map_err(|e|ApiError::internal(e.to_string()))?;
    let length=file.metadata().await.map_err(|e|ApiError::internal(e.to_string()))?.len();
    let mut response=Body::from_stream(tokio_util::io::ReaderStream::new(file)).into_response();
    response.headers_mut().insert(header::CONTENT_TYPE,HeaderValue::from_static("application/octet-stream"));
    response.headers_mut().insert(header::CONTENT_DISPOSITION,HeaderValue::from_str(&format!("attachment; filename=\"{name}\"")).map_err(|e|ApiError::internal(e.to_string()))?);
    response.headers_mut().insert(header::CONTENT_LENGTH,HeaderValue::from(length));
    Ok(response)
}
pub async fn delete(State(state): State<AppState>,_: Admin,_: Csrf,Path(name): Path<String>) -> Result<StatusCode,ApiError> {
    tokio::fs::remove_file(resolve(&state,&name).await?).await.map_err(|e|ApiError::internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
pub struct SettingsUpdate { enabled: Option<bool>,hour_utc: Option<i64>,retention: Option<i64> }
pub async fn settings(State(state): State<AppState>,_: Admin,_: Csrf,Json(payload): Json<SettingsUpdate>) -> Result<Json<Value>,ApiError> {
    if payload.hour_utc.is_some_and(|v| !(0..=23).contains(&v)) || payload.retention.is_some_and(|v| !(1..=365).contains(&v)) {
        return Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY,"hour_utc must be 0–23 and retention must be 1–365"));
    }
    let mut tx=state.pool.begin().await.map_err(db_error)?;
    for (key,value) in [("backup_schedule_enabled",payload.enabled.map(|v|v.to_string())),("backup_schedule_hour_utc",payload.hour_utc.map(|v|v.to_string())),("backup_retention",payload.retention.map(|v|v.to_string()))] {
        if let Some(value)=value { sqlx::query("INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value").bind(key).bind(value).execute(&mut *tx).await.map_err(db_error)?; }
    }
    tx.commit().await.map_err(db_error)?;
    Ok(Json(backup_settings(&state).await?))
}
struct TempFile(PathBuf);
impl Drop for TempFile { fn drop(&mut self) { let _=std::fs::remove_file(&self.0); } }
async fn drain_connections(state: &AppState) -> Result<(), ApiError> {
    let count = state.pool.size();
    let mut connections = Vec::with_capacity(count as usize);
    for _ in 0..count {
        connections.push(state.pool.acquire().await.map_err(db_error)?);
    }
    for connection in connections {
        connection.close().await.map_err(db_error)?;
    }
    Ok(())
}

#[axum::debug_handler(state = AppState)]
pub async fn restore(State(state): State<AppState>, user: Admin, _: Csrf, multipart: Multipart) -> Result<Response,ApiError> {
    let mut multipart = multipart;
    let path=TempFile(std::env::temp_dir().join(format!("tmp{}.dump",Uuid::new_v4())));
    let mut file=tokio::fs::OpenOptions::new().write(true).create_new(true).open(&path.0).await.map_err(|e|ApiError::internal(e.to_string()))?;
    let mut confirm=None;
    let mut size=0u64;
    let mut has_file=false;
    let mut magic=Vec::with_capacity(5);
    let mut upload_error=None;
    while let Some(mut field)=multipart.next_field().await.map_err(|e|ApiError::bad_request(e.to_string()))? {
        match field.name() {
            Some("confirm")=>confirm=Some(field.text().await.map_err(|e|ApiError::bad_request(e.to_string()))?),
            Some("file")=>{
                if has_file { return Err(ApiError::bad_request("Only one backup archive may be uploaded")); }
                has_file=true;
                while let Some(chunk)=field.chunk().await.map_err(|e|ApiError::bad_request(e.to_string()))? {
                    size+=chunk.len() as u64;
                    if size>MAX_UPLOAD && upload_error.is_none() { upload_error=Some(ApiError::new(StatusCode::PAYLOAD_TOO_LARGE,"Backup file exceeds 2 GiB")); }
                    let needed=5-magic.len();
                    magic.extend_from_slice(&chunk[..needed.min(chunk.len())]);
                    if upload_error.is_none() && (magic.len()<5 || magic==b"PGDMP") {
                        file.write_all(&chunk).await.map_err(|e|ApiError::internal(e.to_string()))?;
                    }
                }
            },
            _=>{},
        }
    }
    if confirm.as_deref()!=Some("RESTORE") { return Err(ApiError::bad_request("Type RESTORE to confirm")); }
    if !has_file || magic!=b"PGDMP" { return Err(ApiError::bad_request("Not a pg_dump custom-format archive")); }
    if let Some(error)=upload_error { return Err(error); }
    file.flush().await.map_err(|e|ApiError::internal(e.to_string()))?;
    drop(file);
    dump(&state,"pre_restore",Some(user.0.id)).await?;
    drain_connections(&state).await?;
    let started=Utc::now();
    let output=run(Command::new(executable(&state,"pg_restore")).arg("--clean").arg("--if-exists").arg("--no-owner").arg("--no-privileges").arg(format!("--dbname={}",state.settings.database_url)).arg(&path.0),3600,"pg_restore").await?;
    drain_connections(&state).await?;
    crate::db::migrate(&state.pool).await.map_err(|e|ApiError::internal(format!("Database migration failed: {e}")))?;
    let id=Uuid::new_v4();
    let stderr=stderr_tail(&output.stderr);
    let error=if stderr.is_empty() {None} else {Some(stderr)};
    let mut tx=state.pool.begin().await.map_err(db_error)?;
    sqlx::query("INSERT INTO backup_jobs(id,kind,status,filename,size_bytes,error,user_id,started_at,finished_at) VALUES($1,'restore','success',$2,$3,$4,$5,$6,now())")
        .bind(id).bind(path.0.file_name().unwrap_or_default().to_string_lossy().as_ref()).bind(size as i64).bind(error).bind(user.0.id).bind(started).execute(&mut *tx).await.map_err(db_error)?;
    sqlx::query("INSERT INTO app_settings(key,value) VALUES('session_epoch',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value").bind(Utc::now().timestamp().to_string()).execute(&mut *tx).await.map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    let mut response=Json(job(&state,id).await?).into_response();
    let secure=if state.settings.secure_cookies {"; Secure"} else {""};
    for (cookie,path,samesite) in [
        (state.settings.session_cookie_name.as_str(),"/","Lax"),
        (state.settings.csrf_cookie_name.as_str(),"/","Lax"),
        ("inventorymgr_refresh","/api/auth/refresh","Strict"),
    ] {
        response.headers_mut().append(header::SET_COOKIE,HeaderValue::from_str(&format!("{cookie}=; Path={path}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite={samesite}{secure}")).map_err(|e|ApiError::internal(e.to_string()))?);
    }
    Ok(response)
}

fn should_run(now: DateTime<Utc>,last: Option<DateTime<Utc>>,hour: u32) -> bool {
    last.is_none_or(|last| { let gap=now-last; gap>=chrono::Duration::hours(36) || (gap>=chrono::Duration::hours(23) && now.hour()==hour) })
}
async fn tick(state: &AppState) -> Result<(),ApiError> {
    let _shared = state.database_access.read().await;
    let settings=backup_settings(state).await?;
    if settings["enabled"]!=true { return Ok(()); }
    let mut connection=state.pool.acquire().await.map_err(db_error)?;
    connection.close_on_drop();
    let locked: bool=sqlx::query_scalar("SELECT pg_try_advisory_lock($1)").bind(LOCK_KEY).fetch_one(&mut *connection).await.map_err(db_error)?;
    if !locked { return Ok(()); }
    let last: Option<DateTime<Utc>>=sqlx::query_scalar("SELECT max(started_at) FROM backup_jobs WHERE kind IN('manual','scheduled') AND status='success'").fetch_one(&mut *connection).await.map_err(db_error)?;
    let result=if should_run(Utc::now(),last,settings["hour_utc"].as_u64().unwrap_or(2) as u32) {
        match dump(state,"scheduled",None).await { Ok(_)=>prune(state).await,Err(e)=>Err(e) }
    } else { Ok(()) };
    sqlx::query("SELECT pg_advisory_unlock($1)").bind(LOCK_KEY).execute(&mut *connection).await.map_err(db_error)?;
    result
}
pub async fn scheduler_loop(state: AppState) {
    loop {
        tokio::time::sleep(Duration::from_secs(300)).await;
        if let Err(error)=tick(&state).await { tracing::error!(error=%error.message,"Backup scheduler tick failed"); }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn filenames_are_strict() {
        assert!(valid_filename("inventorymgr-20261009T120000Z-pre_restore.dump"));
        for name in ["../inventorymgr-20261009T120000Z-manual.dump","inventorymgr-20261009T120000Z-.dump","inventorymgr-20261009T120000Z-Manual.dump","inventorymgr-20261009T120000Z-manual.dump/extra"] {assert!(!valid_filename(name));}
    }
    #[test] fn scheduler_matches_daily_rules() {
        let now=DateTime::parse_from_rfc3339("2026-10-09T02:00:00Z").unwrap().with_timezone(&Utc);
        assert!(should_run(now,None,2));
        assert!(!should_run(now,Some(now-chrono::Duration::hours(22)),2));
        assert!(should_run(now,Some(now-chrono::Duration::hours(23)),2));
        assert!(!should_run(now,Some(now-chrono::Duration::hours(25)),3));
        assert!(should_run(now,Some(now-chrono::Duration::hours(36)),3));
    }
}
