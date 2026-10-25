use axum::{
    body::{to_bytes, Body},
    extract::{ConnectInfo, DefaultBodyLimit, Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use serde_json::json;
use std::{net::SocketAddr, sync::Arc};
use tower_http::{compression::CompressionLayer, cors::{AllowOrigin, CorsLayer}, trace::TraceLayer};

mod api;
mod core;
mod db;
mod models;
mod schemas;

use api::deps::AppState;
use core::config::Settings;

async fn health() -> Json<serde_json::Value> {
    Json(json!({"status": "ok"}))
}

async fn database_access(State(state): State<AppState>, request: Request, next: Next) -> Response {
    if request.uri().path() == "/api/health"
        || (request.method() == Method::POST && request.uri().path() == "/api/backups/restore") {
        return next.run(request).await;
    }
    let limit = if request.method() == Method::POST && request.uri().path() == "/api/imports/preview" {
        6 * 1024 * 1024
    } else { 2 * 1024 * 1024 };
    let (parts, body) = request.into_parts();
    let bytes = match to_bytes(body, limit).await {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::PAYLOAD_TOO_LARGE, "Request body exceeds the route limit").into_response(),
    };
    let request = Request::from_parts(parts, Body::from(bytes));
    let _shared = state.database_access.read().await;
    next.run(request).await
}

async fn security_headers(ConnectInfo(addr): ConnectInfo<SocketAddr>, mut request: Request, next: Next) -> Response {
    request.headers_mut().insert(
        header::HeaderName::from_static("x-inventory-peer"),
        HeaderValue::from_str(&addr.ip().to_string()).expect("IP is a valid header"),
    );
    let mut response = next.run(request).await;
    for (name, value) in [
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("x-xss-protection", "0"),
        ("referrer-policy", "strict-origin-when-cross-origin"),
        ("permissions-policy", "camera=(), microphone=(), geolocation=()"),
    ] {
        response.headers_mut().insert(header::HeaderName::from_static(name), HeaderValue::from_static(value));
    }
    response
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();
    let settings = Settings::from_env();
    let pool = db::create_pool(&settings.database_url).await?;
    db::migrate(&pool).await?;
    let state = AppState {
        pool,
        settings: Arc::new(settings.clone()),
        database_access: Arc::new(tokio::sync::RwLock::new(())),
    };
    let mut backup_owner = api::auxiliary::initialize_backups(&state).await
        .map_err(|error| std::io::Error::other(error.message))?;
    let scheduler = if settings.app_env != "test" {
        Some(tokio::spawn(api::auxiliary::scheduler_loop(state.clone())))
    } else { None };
    let origins = settings.cors_origins.iter().map(|origin| HeaderValue::from_str(origin)).collect::<Result<Vec<_>, _>>()?;
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE, header::HeaderName::from_static("x-csrf-token")])
        .allow_credentials(true);
    let routes = Router::new()
        .merge(api::auth::router()).merge(api::accounts::router())
        .merge(api::inventory::router()).merge(api::auxiliary::router());
    let app = Router::new().route("/api/health", get(health)).nest("/api", routes)
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024)).layer(CompressionLayer::new())
        .layer(middleware::from_fn_with_state(state.clone(), database_access))
        .layer(cors).layer(middleware::from_fn(security_headers))
        .layer(TraceLayer::new_for_http()).with_state(state);
    let listener = tokio::net::TcpListener::bind((settings.host.as_str(), settings.port)).await?;
    tracing::info!("InventoryMGR listening on {}", listener.local_addr()?);
    // Retain the exact lease session through graceful drain. Never reconnect it:
    // another process may acquire ownership as soon as this session is lost.
    let lease_monitor = async {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            match tokio::time::timeout(std::time::Duration::from_secs(2),
                sqlx::query("SELECT 1").execute(&mut backup_owner)).await {
                Ok(Ok(_)) => {},
                Ok(Err(error)) => break Err(std::io::Error::other(format!("Database instance lease lost: {error}"))),
                Err(_) => break Err(std::io::Error::other("Database instance lease probe timed out")),
            }
        }
    };
    let result = tokio::select! {
        result = async {
            axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
                .with_graceful_shutdown(shutdown_signal()).await
        } => result,
        result = lease_monitor => result,
    };
    if let Some(scheduler) = scheduler { scheduler.abort(); }
    result?;
    Ok(())
}
