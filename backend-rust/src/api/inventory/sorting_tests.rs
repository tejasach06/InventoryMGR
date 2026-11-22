use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use crate::api::deps::AppState;
use crate::core::config::Settings;
use serde_json::{json, Value};
use std::{process::Command, sync::Arc, time::{Duration, Instant}};
use tower::ServiceExt;
use uuid::Uuid;

struct Database(String);
impl Database {
    fn command(args: &[&str]) -> String {
        let result = Command::new("podman")
            .args(args)
            .output()
            .expect("podman is required for isolated tests");
        assert!(result.status.success(), "podman failed: {}", String::from_utf8_lossy(&result.stderr));
        String::from_utf8(result.stdout).unwrap().trim().to_owned()
    }

    async fn start_raw() -> (Self, sqlx::PgPool, String) {
        let name = format!("inventorymgr-sorting-test-{}", Uuid::new_v4().simple());
        Self::command(&[
            "run",
            "--detach",
            "--rm",
            "--name",
            &name,
            "--publish",
            "127.0.0.1::5432",
            "--env",
            "POSTGRES_HOST_AUTH_METHOD=trust",
            "docker.io/library/postgres:17-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27",
        ]);
        let database = Self(name);
        let binding = Self::command(&["port", &database.0, "5432/tcp"]);
        let port = binding.rsplit(':').next().unwrap();
        let url = format!("postgresql://postgres@127.0.0.1:{port}/postgres");
        let deadline = Instant::now() + Duration::from_secs(30);
        let pool = loop {
            match sqlx::postgres::PgPoolOptions::new()
                .acquire_timeout(Duration::from_secs(1))
                .connect(&url)
                .await
            {
                Ok(pool) => break pool,
                Err(_) if Instant::now() < deadline => tokio::time::sleep(Duration::from_millis(50)).await,
                Err(error) => panic!("Disposable PostgreSQL did not start: {error}"),
            }
        };
        (database, pool, url)
    }

    async fn start() -> (Self, AppState) {
        let (database, pool, url) = Self::start_raw().await;
        crate::db::migrate(&pool).await.unwrap();
        let state = AppState {
            pool,
            settings: Arc::new(Settings {
                app_env: "test".into(),
                database_url: url,
                jwt_secret: "sorting-regression-fixture-key-not-production".into(),
                session_cookie_name: "session".into(),
                csrf_cookie_name: "csrf".into(),
                secure_cookies: false,
                cors_origins: Vec::new(),
                backup_dir: format!("/tmp/{}", database.0),
                pg_bin_dir: String::new(),
                host: "127.0.0.1".into(),
                port: 0,
            }),
            database_access: Arc::new(tokio::sync::RwLock::new(())),
        };
        (database, state)
    }
}

impl Drop for Database {
    fn drop(&mut self) {
        Self::command(&["rm", "--force", &self.0]);
    }
}

#[derive(Default, Clone)]
struct Browser {
    cookie: String,
    csrf: String,
}

impl Browser {
    async fn request(&mut self, state: &AppState, method: &str, path: &str, payload: Option<Value>) -> (StatusCode, Value) {
        let app = crate::api::auth::router()
            .merge(crate::api::accounts::router())
            .merge(crate::api::inventory::router())
            .merge(crate::api::auxiliary::router())
            .with_state(state.clone());
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::COOKIE, &self.cookie)
            .header("x-csrf-token", &self.csrf);
        let body = if let Some(payload) = payload {
            request = request.header(header::CONTENT_TYPE, "application/json");
            Body::from(payload.to_string())
        } else {
            Body::empty()
        };
        let response = app.oneshot(request.body(body).unwrap()).await.unwrap();
        let status = response.status();
        let cookies: Vec<_> = response
            .headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_owned())
            .collect();
        if !cookies.is_empty() {
            self.csrf = cookies.iter().find_map(|c| c.strip_prefix("csrf=")).unwrap_or("").to_owned();
            self.cookie = cookies.join("; ");
        }
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
    }
}

#[tokio::test]
async fn test_db_sorting_ip_numeric_and_invalid_ip_handling() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    assert_eq!(
        client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await.0,
        StatusCode::CREATED
    );

    // Create 3 VMs:
    // vm-ten: private IP 10.0.0.10
    // vm-nine: private IP 10.0.0.9
    // vm-bad: private IP "not-an-ip-string"
    assert_eq!(
        client.request(&state, "POST", "/vms", Some(json!({
            "name": "vm-ten", "platform": "vmware", "cluster": "c1", "status": "running", "criticality": "medium",
            "cpu_cores": 2, "memory_mb": 2048,
            "networks": [{"ip_address": "10.0.0.10", "role": "private"}]
        }))).await.0,
        StatusCode::CREATED
    );
    assert_eq!(
        client.request(&state, "POST", "/vms", Some(json!({
            "name": "vm-nine", "platform": "vmware", "cluster": "c1", "status": "running", "criticality": "medium",
            "cpu_cores": 2, "memory_mb": 2048,
            "networks": [{"ip_address": "10.0.0.9", "role": "private"}]
        }))).await.0,
        StatusCode::CREATED
    );
    assert_eq!(
        client.request(&state, "POST", "/vms", Some(json!({
            "name": "vm-bad", "platform": "vmware", "cluster": "c1", "status": "running", "criticality": "medium",
            "cpu_cores": 2, "memory_mb": 2048,
            "networks": [{"ip_address": "not-an-ip-string", "role": "private"}]
        }))).await.0,
        StatusCode::CREATED
    );

    // Ascending: 10.0.0.9 before 10.0.0.10, non-IP comes after valid IPs, no error
    let (status, res) = client.request(&state, "GET", "/vms?sort=private_ip&dir=asc", None).await;
    assert_eq!(status, StatusCode::OK);
    let items = res["items"].as_array().unwrap();
    let names: Vec<&str> = items.iter().map(|i| i["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["vm-nine", "vm-ten", "vm-bad"]);

    // Descending: 10.0.0.10 before 10.0.0.9
    let (status, res) = client.request(&state, "GET", "/vms?sort=private_ip&dir=desc", None).await;
    assert_eq!(status, StatusCode::OK);
    let items = res["items"].as_array().unwrap();
    let names: Vec<&str> = items.iter().map(|i| i["name"].as_str().unwrap()).collect();
    // In DESC: "not-an-ip-string" evaluates to NULL inet so it appears first, then 10.0.0.10 then 10.0.0.9
    assert_eq!(names, vec!["vm-bad", "vm-ten", "vm-nine"]);
}

#[tokio::test]
async fn test_db_sorting_tags_and_virtual_hosts_first_alphabetical() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    // vm-z-first: virtual_hosts ["zebra.local", "alpha.local"], tags ["zebra", "apple"]
    // vm-b-only: virtual_hosts ["beta.local"], tags ["banana"]
    assert_eq!(
        client.request(&state, "POST", "/vms", Some(json!({
            "name": "vm-z-first", "platform": "vmware", "cluster": "c1", "status": "running", "criticality": "medium",
            "cpu_cores": 2, "memory_mb": 2048,
            "virtual_hosts": ["zebra.local", "alpha.local"],
            "tags": ["zebra", "apple"]
        }))).await.0,
        StatusCode::CREATED
    );
    assert_eq!(
        client.request(&state, "POST", "/vms", Some(json!({
            "name": "vm-b-only", "platform": "vmware", "cluster": "c1", "status": "running", "criticality": "medium",
            "cpu_cores": 2, "memory_mb": 2048,
            "virtual_hosts": ["beta.local"],
            "tags": ["banana"]
        }))).await.0,
        StatusCode::CREATED
    );

    // virtual_hosts asc: "alpha.local" < "beta.local"
    let (status, res) = client.request(&state, "GET", "/vms?sort=virtual_hosts&dir=asc", None).await;
    assert_eq!(status, StatusCode::OK);
    let names: Vec<&str> = res["items"].as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["vm-z-first", "vm-b-only"]);

    // tags asc: "apple" < "banana"
    let (status, res) = client.request(&state, "GET", "/vms?sort=tags&dir=asc", None).await;
    assert_eq!(status, StatusCode::OK);
    let names: Vec<&str> = res["items"].as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["vm-z-first", "vm-b-only"]);
}

#[tokio::test]
async fn test_db_sorting_booleans_text_case_and_null_placement() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    // vm-1: cluster "Alpha", pmp_enabled false, datacenter "dc-1"
    // vm-2: cluster "beta", pmp_enabled true, datacenter null
    assert_eq!(
        client.request(&state, "POST", "/vms", Some(json!({
            "name": "vm-1", "platform": "vmware", "cluster": "Alpha", "datacenter": "dc-1",
            "status": "running", "criticality": "medium", "cpu_cores": 2, "memory_mb": 2048,
            "pmp_enabled": false
        }))).await.0,
        StatusCode::CREATED
    );
    assert_eq!(
        client.request(&state, "POST", "/vms", Some(json!({
            "name": "vm-2", "platform": "vmware", "cluster": "beta",
            "status": "running", "criticality": "medium", "cpu_cores": 2, "memory_mb": 2048,
            "pmp_enabled": true
        }))).await.0,
        StatusCode::CREATED
    );

    // Case-insensitive cluster text: "Alpha" before "beta"
    let (status, res) = client.request(&state, "GET", "/vms?sort=cluster&dir=asc", None).await;
    assert_eq!(status, StatusCode::OK);
    let names: Vec<&str> = res["items"].as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["vm-1", "vm-2"]);

    // Boolean asc: false before true
    let (status, res) = client.request(&state, "GET", "/vms?sort=pmp_enabled&dir=asc", None).await;
    assert_eq!(status, StatusCode::OK);
    let names: Vec<&str> = res["items"].as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["vm-1", "vm-2"]);

    // Null placement for datacenter:
    // asc: non-null ("dc-1") first, null last
    let (status, res) = client.request(&state, "GET", "/vms?sort=datacenter&dir=asc", None).await;
    assert_eq!(status, StatusCode::OK);
    let names: Vec<&str> = res["items"].as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["vm-1", "vm-2"]);

    // desc: null first, non-null ("dc-1") last
    let (status, res) = client.request(&state, "GET", "/vms?sort=datacenter&dir=desc", None).await;
    assert_eq!(status, StatusCode::OK);
    let names: Vec<&str> = res["items"].as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["vm-2", "vm-1"]);
}
