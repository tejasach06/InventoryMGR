mod backups;
mod imports;
mod reporting;

use axum::{extract::DefaultBodyLimit, routing::{get, post}, Router};
use crate::api::deps::AppState;
pub use backups::scheduler_loop;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/imports/preview", post(imports::preview))
        .route("/imports/template", get(imports::template))
        .route("/imports/{batch_id}", get(imports::get_batch))
        .route("/imports/{batch_id}/commit", post(imports::commit))
        .route("/backups", get(backups::overview).post(backups::create))
        .route("/backups/settings", axum::routing::patch(backups::settings))
        .route("/backups/restore", post(backups::restore))
        .route("/backups/{filename}/download", get(backups::download))
        .route("/backups/{filename}", axum::routing::delete(backups::delete))
        .route("/reports/summary", get(reporting::summary))
        .route("/reports/{report_name}", get(reporting::report))
        .route("/dashboard", get(reporting::dashboard))
        .route("/notifications/decommissions", get(reporting::due))
        .route("/notifications/decommissions/ack", post(reporting::ack))
        .route("/notifications/duplicate-ips", get(reporting::duplicate_ips))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024 * 1024 + 1024 * 1024))
}

pub(super) fn db_error(error: sqlx::Error) -> crate::api::deps::ApiError {
    crate::api::deps::ApiError::internal(error.to_string())
}

pub(super) async fn setting(pool: &sqlx::PgPool, key: &str, default: &str) -> Result<String, crate::api::deps::ApiError> {
    Ok(sqlx::query_scalar::<_, String>("SELECT value FROM app_settings WHERE key=$1")
        .bind(key).fetch_optional(pool).await.map_err(db_error)?.unwrap_or_else(|| default.into()))
}
