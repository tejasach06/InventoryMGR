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
        let name = format!("inventorymgr-ipmap-test-{}", Uuid::new_v4().simple());
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
                jwt_secret: "ipmap-regression-fixture-key-not-production".into(),
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
async fn migration_empty_database_and_schema_verification() {
    let (_db, state) = Database::start().await;
    let version: String = sqlx::query_scalar("SELECT version_num FROM alembic_version")
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(version, "0026");

    let exists: bool = sqlx::query_scalar("SELECT to_regclass('public.vm_ip_mappings') IS NOT NULL")
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert!(exists, "vm_ip_mappings table must exist");

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM vm_ip_mappings")
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(count, 0, "Fresh database starts with 0 mappings");
}

#[tokio::test]
async fn migration_from_0025_preserves_rows_and_zero_inferred_pairs() {
    let (_db, pool, _url) = Database::start_raw().await;
    const SCHEMA: &str = include_str!("../../../migrations/0001_inventory_schema.sql");
    let marker = "-- Running upgrade 0025 -> 0026";
    let offset = SCHEMA.find(marker).expect("0025 -> 0026 marker found");
    let schema_0025: &'static str = Box::leak(format!("{}\nCOMMIT;", &SCHEMA[..offset]).into_boxed_str());

    let mut conn = pool.acquire().await.unwrap();
    crate::db::execute_migration(&mut conn, schema_0025).await.unwrap();

    let version: String = sqlx::query_scalar("SELECT version_num FROM alembic_version")
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(version, "0025");

    // Insert sentinel user, cluster, VM, and duplicate network rows
    let user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id, email, password_hash, role, is_active, created_at, updated_at) VALUES($1, 'sentinel@test.local', 'hash', 'admin', true, now(), now())")
        .bind(user_id)
        .execute(&mut *conn)
        .await
        .unwrap();

    let vm_id = Uuid::new_v4();
    sqlx::query("INSERT INTO vms(id, name, platform, cluster, status, criticality, cpu_cores, memory_mb, environment, pmp_enabled, monitoring_enabled, backup_enabled, ha_enabled, tags, created_by_id, updated_by_id, created_at, updated_at) VALUES($1, 'legacy-vm', 'vmware', 'cluster1', 'running', 'medium', 2, 2048, 'production', false, false, false, false, '[]'::jsonb, $2, $2, now(), now())")
        .bind(vm_id)
        .bind(user_id)
        .execute(&mut *conn)
        .await
        .unwrap();

    // Duplicate IP addresses exist in pre-0026 data
    let net1 = Uuid::new_v4();
    let net2 = Uuid::new_v4();
    let net3 = Uuid::new_v4();
    let net4 = Uuid::new_v4();
    sqlx::query("INSERT INTO vm_networks(id, vm_id, ip_address, role, sort_order) VALUES($1, $2, '10.0.0.1', 'private', 0)")
        .bind(net1).bind(vm_id).execute(&mut *conn).await.unwrap();
    sqlx::query("INSERT INTO vm_networks(id, vm_id, ip_address, role, sort_order) VALUES($1, $2, '10.0.0.1', 'private', 1)")
        .bind(net2).bind(vm_id).execute(&mut *conn).await.unwrap();
    sqlx::query("INSERT INTO vm_networks(id, vm_id, ip_address, role, sort_order) VALUES($1, $2, '203.0.113.1', 'public', 2)")
        .bind(net3).bind(vm_id).execute(&mut *conn).await.unwrap();
    sqlx::query("INSERT INTO vm_networks(id, vm_id, ip_address, role, sort_order) VALUES($1, $2, '10.0.99.1', 'backup', 3)")
        .bind(net4).bind(vm_id).execute(&mut *conn).await.unwrap();

    drop(conn);

    // Run migration
    crate::db::migrate(&pool).await.unwrap();

    let mut conn = pool.acquire().await.unwrap();
    let version: String = sqlx::query_scalar("SELECT version_num FROM alembic_version")
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(version, "0026");

    // Existing rows preserved
    let net_count: i64 = sqlx::query_scalar("SELECT count(*) FROM vm_networks WHERE vm_id=$1")
        .bind(vm_id)
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(net_count, 4, "All 4 historical network rows preserved");

    // Zero inferred pairs created
    let mapping_count: i64 = sqlx::query_scalar("SELECT count(*) FROM vm_ip_mappings")
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(mapping_count, 0, "Zero inferred pairs created on historical upgrade");
}

#[tokio::test]
async fn api_one_to_many_shared_private_targets_and_deduplication() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    assert_eq!(client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await.0, StatusCode::CREATED);

    let create_payload = json!({
        "name": "edge-router",
        "platform": "vmware",
        "cluster": "prod",
        "status": "running",
        "criticality": "high",
        "cpu_cores": 4,
        "memory_mb": 8192,
        "networks": [
            {"ip_address": "203.0.113.1", "role": "public"},
            {"ip_address": "203.0.113.2", "role": "public"},
            {"ip_address": "10.0.0.1", "role": "private"},
            {"ip_address": "10.0.0.2", "role": "private"}
        ],
        "ip_mappings": [
            // One-to-many: 203.0.113.1 maps to both 10.0.0.1 and 10.0.0.2
            {"public_ip": "203.0.113.1", "private_ip": "10.0.0.1"},
            {"public_ip": "203.0.113.1", "private_ip": "10.0.0.2"},
            // Shared private target: 10.0.0.1 also targeted by 203.0.113.2
            {"public_ip": "203.0.113.2", "private_ip": "10.0.0.1"},
            // Duplicate pair: identical pair submitted twice
            {"public_ip": "203.0.113.1", "private_ip": "10.0.0.1"}
        ]
    });

    let (status, vm) = client.request(&state, "POST", "/vms", Some(create_payload)).await;
    assert_eq!(status, StatusCode::CREATED, "{vm}");
    let vm_id = vm["id"].as_str().unwrap();

    let expected_mappings = json!([
        {"public_ip": "203.0.113.1", "private_ip": "10.0.0.1"},
        {"public_ip": "203.0.113.1", "private_ip": "10.0.0.2"},
        {"public_ip": "203.0.113.2", "private_ip": "10.0.0.1"}
    ]);
    assert_eq!(vm["ip_mappings"], expected_mappings, "Duplicate was stored once and mappings are sorted deterministically");

    // Detail query GET /vms/{id}
    let (status, detail) = client.request(&state, "GET", &format!("/vms/{vm_id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["ip_mappings"], expected_mappings);

    // List query GET /vms
    let (status, list) = client.request(&state, "GET", "/vms", None).await;
    assert_eq!(status, StatusCode::OK);
    let items = list["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["ip_mappings"], expected_mappings);
}

#[tokio::test]
async fn api_mapping_only_edits() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    let (status, vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "web-srv", "platform": "vmware", "cluster": "prod", "status": "running",
        "criticality": "low", "cpu_cores": 1, "memory_mb": 1024,
        "networks": [
            {"ip_address": "203.0.113.10", "role": "public"},
            {"ip_address": "10.0.0.10", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.10", "private_ip": "10.0.0.10"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::CREATED);
    let vm_id = vm["id"].as_str().unwrap();

    // Mapping-only edit: no networks in payload
    let (status, patched) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "ip_mappings": [],
        "network_precondition": vm["network_precondition"]
    }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(patched["ip_mappings"], json!([]));
    assert_eq!(patched["networks"].as_array().unwrap().len(), 2, "Networks remained untouched");
}

#[tokio::test]
async fn api_omitted_vs_empty() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    let (_, vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "app-srv", "platform": "vmware", "cluster": "prod", "status": "running",
        "criticality": "low", "cpu_cores": 1, "memory_mb": 1024,
        "networks": [
            {"ip_address": "203.0.113.20", "role": "public"},
            {"ip_address": "10.0.0.20", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.20", "private_ip": "10.0.0.20"}
        ]
    }))).await;
    let vm_id = vm["id"].as_str().unwrap();

    // Omission preserves mappings
    let (status, patched) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "description": "updated description"
    }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(patched["description"], "updated description");
    assert_eq!(patched["ip_mappings"], json!([{"public_ip": "203.0.113.20", "private_ip": "10.0.0.20"}]));

    // Empty array clears mappings
    let (status, cleared) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "ip_mappings": [],
        "network_precondition": patched["network_precondition"]
    }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cleared["ip_mappings"], json!([]));
}

#[tokio::test]
async fn api_legacy_form_saves_and_preservation() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    let (_, vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "db-srv", "platform": "vmware", "cluster": "prod", "status": "running",
        "criticality": "medium", "cpu_cores": 2, "memory_mb": 4096,
        "networks": [
            {"ip_address": "203.0.113.30", "role": "public"},
            {"ip_address": "10.0.0.30", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.30", "private_ip": "10.0.0.30"}
        ]
    }))).await;
    let vm_id = vm["id"].as_str().unwrap();

    // Legacy form save sends networks but omits ip_mappings: endpoints are preserved
    let (status, form_saved) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "networks": [
            {"ip_address": "203.0.113.30", "role": "public"},
            {"ip_address": "10.0.0.30", "role": "private"},
            {"ip_address": "10.0.0.31", "role": "private"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::OK, "{form_saved}");
    assert_eq!(form_saved["ip_mappings"], json!([{"public_ip": "203.0.113.30", "private_ip": "10.0.0.30"}]));

    // Form save that removes a linked endpoint while omitting ip_mappings is rejected with 409 Conflict
    let (status, conflict) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "networks": [
            {"ip_address": "203.0.113.30", "role": "public"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{conflict}");

    // Form save that changes role of linked endpoint while omitting ip_mappings is rejected with 409 Conflict
    let (status, conflict_role) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "networks": [
            {"ip_address": "203.0.113.30", "role": "private"},
            {"ip_address": "10.0.0.30", "role": "private"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{conflict_role}");
}

#[tokio::test]
async fn api_cross_vm_and_wrong_role_rejection() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    // Create VM A
    let (_, vm_a) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "vm-a", "platform": "vmware", "cluster": "c", "status": "running",
        "criticality": "low", "cpu_cores": 1, "memory_mb": 1024,
        "networks": [
            {"ip_address": "203.0.113.41", "role": "public"},
            {"ip_address": "10.0.0.41", "role": "private"}
        ]
    }))).await;
    let vm_a_id = vm_a["id"].as_str().unwrap();

    // Create VM B
    client.request(&state, "POST", "/vms", Some(json!({
        "name": "vm-b", "platform": "vmware", "cluster": "c", "status": "running",
        "criticality": "low", "cpu_cores": 1, "memory_mb": 1024,
        "networks": [
            {"ip_address": "203.0.113.42", "role": "public"},
            {"ip_address": "10.0.0.42", "role": "private"}
        ]
    }))).await;

    // Reject cross-VM address
    let (status, err) = client.request(&state, "PATCH", &format!("/vms/{vm_a_id}"), Some(json!({
        "ip_mappings": [
            {"public_ip": "203.0.113.41", "private_ip": "10.0.0.42"}
        ],
        "network_precondition": vm_a["network_precondition"]
    }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(err["detail"][0]["loc"], json!(["body", "ip_mappings", 0, "private_ip"]));

    // Reject non-existent address
    let (status, err) = client.request(&state, "PATCH", &format!("/vms/{vm_a_id}"), Some(json!({
        "ip_mappings": [
            {"public_ip": "198.51.100.1", "private_ip": "10.0.0.41"}
        ],
        "network_precondition": vm_a["network_precondition"]
    }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(err["detail"][0]["loc"], json!(["body", "ip_mappings", 0, "public_ip"]));

    // Create VM with backup IP
    let (_, vm_c) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "vm-c", "platform": "vmware", "cluster": "c", "status": "running",
        "criticality": "low", "cpu_cores": 1, "memory_mb": 1024,
        "networks": [
            {"ip_address": "203.0.113.50", "role": "public"},
            {"ip_address": "10.0.0.50", "role": "private"},
            {"ip_address": "10.0.99.50", "role": "backup"}
        ]
    }))).await;
    let vm_c_id = vm_c["id"].as_str().unwrap();

    // Reject wrong role: private address used as public_ip
    let (status, err) = client.request(&state, "PATCH", &format!("/vms/{vm_c_id}"), Some(json!({
        "ip_mappings": [
            {"public_ip": "10.0.0.50", "private_ip": "10.0.0.50"}
        ],
        "network_precondition": vm_c["network_precondition"]
    }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err["detail"][0]["msg"].as_str().unwrap().contains("expected 'public'"));

    // Reject wrong role: backup address used as private_ip
    let (status, err) = client.request(&state, "PATCH", &format!("/vms/{vm_c_id}"), Some(json!({
        "ip_mappings": [
            {"public_ip": "203.0.113.50", "private_ip": "10.0.99.50"}
        ],
        "network_precondition": vm_c["network_precondition"]
    }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err["detail"][0]["msg"].as_str().unwrap().contains("expected 'private'"));

    // IPv4 normalization: CIDR in mapping resolves to normalized network entry
    let (status, ok) = client.request(&state, "PATCH", &format!("/vms/{vm_c_id}"), Some(json!({
        "ip_mappings": [
            {"public_ip": " 203.0.113.50/24 ", "private_ip": "10.0.0.50/16"}
        ],
        "network_precondition": vm_c["network_precondition"]
    }))).await;
    assert_eq!(status, StatusCode::OK, "{ok}");
    assert_eq!(ok["ip_mappings"], json!([{"public_ip": "203.0.113.50", "private_ip": "10.0.0.50"}]));
}

#[tokio::test]
async fn api_linked_edits_and_deletes_rejection() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    let (_, vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "child-test", "platform": "vmware", "cluster": "c", "status": "running",
        "criticality": "low", "cpu_cores": 1, "memory_mb": 1024,
        "networks": [
            {"ip_address": "203.0.113.60", "role": "public"},
            {"ip_address": "10.0.0.60", "role": "private"},
            {"ip_address": "10.0.0.61", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.60", "private_ip": "10.0.0.60"}
        ]
    }))).await;
    let vm_id = vm["id"].as_str().unwrap();
    let networks = vm["networks"].as_array().unwrap();
    let linked_pub_id = networks.iter().find(|n| n["ip_address"] == "203.0.113.60").unwrap()["id"].as_str().unwrap();
    let linked_priv_id = networks.iter().find(|n| n["ip_address"] == "10.0.0.60").unwrap()["id"].as_str().unwrap();
    let unlinked_priv_id = networks.iter().find(|n| n["ip_address"] == "10.0.0.61").unwrap()["id"].as_str().unwrap();

    // Child DELETE on linked public row rejected with 409 Conflict
    let (status, err) = client.request(&state, "DELETE", &format!("/vms/{vm_id}/networks/{linked_pub_id}"), None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{err}");

    // Child DELETE on linked private row rejected with 409 Conflict
    let (status, err) = client.request(&state, "DELETE", &format!("/vms/{vm_id}/networks/{linked_priv_id}"), None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{err}");

    // Child PATCH modifying IP on linked row rejected with 409 Conflict
    let (status, err) = client.request(&state, "PATCH", &format!("/vms/{vm_id}/networks/{linked_pub_id}"), Some(json!({
        "ip_address": "203.0.113.69"
    }))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{err}");

    // Child PATCH modifying role on linked row rejected with 409 Conflict
    let (status, err) = client.request(&state, "PATCH", &format!("/vms/{vm_id}/networks/{linked_pub_id}"), Some(json!({
        "role": "private"
    }))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{err}");

    // Child PATCH modifying sort_order on linked row is allowed
    let (status, ok) = client.request(&state, "PATCH", &format!("/vms/{vm_id}/networks/{linked_pub_id}"), Some(json!({
        "sort_order": 99
    }))).await;
    assert_eq!(status, StatusCode::OK, "{ok}");

    // Child DELETE on unlinked row is allowed
    let (status, _) = client.request(&state, "DELETE", &format!("/vms/{vm_id}/networks/{unlinked_priv_id}"), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Missing VM returns 404 for network child create/patch/delete
    let random_vm = Uuid::new_v4();
    let random_child = Uuid::new_v4();
    let (status, err) = client.request(&state, "POST", &format!("/vms/{random_vm}/networks"), Some(json!({"ip_address": "10.0.0.1", "role": "private"}))).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{err}");
    let (status, err) = client.request(&state, "PATCH", &format!("/vms/{random_vm}/networks/{random_child}"), Some(json!({"sort_order": 1}))).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{err}");
    let (status, err) = client.request(&state, "DELETE", &format!("/vms/{random_vm}/networks/{random_child}"), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{err}");

    // Missing child network on existing VM returns 404
    let (status, err) = client.request(&state, "PATCH", &format!("/vms/{vm_id}/networks/{random_child}"), Some(json!({"sort_order": 1}))).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{err}");
    let (status, err) = client.request(&state, "DELETE", &format!("/vms/{vm_id}/networks/{random_child}"), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{err}");

    // Parent VM-level edit can unlink and change endpoints atomically
    let (_, vm_current) = client.request(&state, "GET", &format!("/vms/{vm_id}"), None).await;
    let (status, vm_updated) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "networks": [
            {"ip_address": "203.0.113.70", "role": "public"},
            {"ip_address": "10.0.0.70", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.70", "private_ip": "10.0.0.70"}
        ],
        "network_precondition": vm_current["network_precondition"]
    }))).await;
    assert_eq!(status, StatusCode::OK, "{vm_updated}");
    assert_eq!(vm_updated["ip_mappings"], json!([{"public_ip": "203.0.113.70", "private_ip": "10.0.0.70"}]));
}

#[tokio::test]
async fn api_vm_clone_retains_pairs() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    let (_, source_vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "gold-image", "platform": "vmware", "cluster": "c", "status": "running",
        "criticality": "high", "cpu_cores": 2, "memory_mb": 2048,
        "networks": [
            {"ip_address": "203.0.113.80", "role": "public"},
            {"ip_address": "10.0.0.80", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.80", "private_ip": "10.0.0.80"}
        ]
    }))).await;
    let source_id = source_vm["id"].as_str().unwrap();

    let (status, cloned_vm) = client.request(&state, "POST", &format!("/vms/{source_id}/clone"), None).await;
    assert_eq!(status, StatusCode::CREATED, "{cloned_vm}");
    let cloned_id = cloned_vm["id"].as_str().unwrap();
    assert_ne!(cloned_id, source_id);

    // Cloned VM retains the pairs mapped to the newly cloned network rows
    assert_eq!(cloned_vm["ip_mappings"], json!([{"public_ip": "203.0.113.80", "private_ip": "10.0.0.80"}]));

    // Deleting mapping on cloned VM does not affect source VM
    let (status, _) = client.request(&state, "PATCH", &format!("/vms/{cloned_id}"), Some(json!({
        "ip_mappings": [],
        "network_precondition": cloned_vm["network_precondition"]
    }))).await;
    assert_eq!(status, StatusCode::OK);

    let (_, source_check) = client.request(&state, "GET", &format!("/vms/{source_id}"), None).await;
    assert_eq!(source_check["ip_mappings"], json!([{"public_ip": "203.0.113.80", "private_ip": "10.0.0.80"}]));
}

#[tokio::test]
async fn api_vm_deletion_cascades() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    let (_, vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "ephemeral-vm", "platform": "vmware", "cluster": "c", "status": "running",
        "criticality": "low", "cpu_cores": 1, "memory_mb": 1024,
        "networks": [
            {"ip_address": "203.0.113.90", "role": "public"},
            {"ip_address": "10.0.0.90", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.90", "private_ip": "10.0.0.90"}
        ]
    }))).await;
    let vm_id = Uuid::parse_str(vm["id"].as_str().unwrap()).unwrap();

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM vm_ip_mappings WHERE vm_id = $1")
        .bind(vm_id)
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);

    let (status, _) = client.request(&state, "DELETE", &format!("/vms/{vm_id}"), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let count_after: i64 = sqlx::query_scalar("SELECT count(*) FROM vm_ip_mappings WHERE vm_id = $1")
        .bind(vm_id)
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(count_after, 0, "VM deletion cascaded to vm_ip_mappings");
}

#[tokio::test]
async fn api_ip_mappings_audit_log_events() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    // 1. Initial VM create with mappings records audit event
    let (status, vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "audit-vm", "platform": "vmware", "cluster": "c", "status": "running",
        "criticality": "low", "cpu_cores": 1, "memory_mb": 1024,
        "networks": [
            {"ip_address": "203.0.113.10", "role": "public"},
            {"ip_address": "10.0.0.10", "role": "private"},
            {"ip_address": "10.0.0.11", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.10", "private_ip": "10.0.0.10"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::CREATED);
    let vm_id = vm["id"].as_str().unwrap();

    let (status, audit) = client.request(&state, "GET", &format!("/vms/{vm_id}/audit"), None).await;
    assert_eq!(status, StatusCode::OK);
    let rows = audit.as_array().unwrap();
    let mapping_event = rows.iter().find(|e| e["field_name"] == "ip_mappings").expect("audit event for initial mappings");
    assert!(mapping_event["old_value"].is_null());
    assert_eq!(mapping_event["new_value"], "203.0.113.10>10.0.0.10");
    assert_eq!(mapping_event["user"]["email"], "admin@example.com");

    // 2. Reordering and duplicate input produces NO spurious audit events
    let initial_count = rows.iter().filter(|e| e["field_name"] == "ip_mappings").count();
    let (status, patched1) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "ip_mappings": [
            {"public_ip": "203.0.113.10", "private_ip": "10.0.0.10"},
            {"public_ip": "203.0.113.10", "private_ip": "10.0.0.10"}
        ],
        "network_precondition": vm["network_precondition"]
    }))).await;
    assert_eq!(status, StatusCode::OK);
    let (_, audit2) = client.request(&state, "GET", &format!("/vms/{vm_id}/audit"), None).await;
    let count2 = audit2.as_array().unwrap().iter().filter(|e| e["field_name"] == "ip_mappings").count();
    assert_eq!(count2, initial_count, "No duplicate audit entry for identical mappings");

    // 3. Mapping replace records before and after canonical strings
    let (status, patched2) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "ip_mappings": [
            {"public_ip": "203.0.113.10", "private_ip": "10.0.0.10"},
            {"public_ip": "203.0.113.10", "private_ip": "10.0.0.11"}
        ],
        "network_precondition": patched1["network_precondition"]
    }))).await;
    assert_eq!(status, StatusCode::OK);
    let (_, audit3) = client.request(&state, "GET", &format!("/vms/{vm_id}/audit"), None).await;
    let rows3 = audit3.as_array().unwrap();
    let latest_event = &rows3[0];
    assert_eq!(latest_event["field_name"], "ip_mappings");
    assert_eq!(latest_event["old_value"], "203.0.113.10>10.0.0.10");
    assert_eq!(latest_event["new_value"], "203.0.113.10>10.0.0.10;203.0.113.10>10.0.0.11");

    // 4. Mapping clear records new_value as null
    let (status, cleared) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "ip_mappings": [],
        "network_precondition": patched2["network_precondition"]
    }))).await;
    assert_eq!(status, StatusCode::OK);
    let (_, audit4) = client.request(&state, "GET", &format!("/vms/{vm_id}/audit"), None).await;
    let latest_event4 = &audit4.as_array().unwrap()[0];
    assert_eq!(latest_event4["field_name"], "ip_mappings");
    assert_eq!(latest_event4["old_value"], "203.0.113.10>10.0.0.10;203.0.113.10>10.0.0.11");
    assert!(latest_event4["new_value"].is_null());

    // 5. Failed validation leaves no audit entry
    let audit_count_before = audit4.as_array().unwrap().len();
    let (status, _) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "ip_mappings": [{"public_ip": "198.51.100.99", "private_ip": "10.0.0.10"}],
        "network_precondition": cleared["network_precondition"]
    }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (_, audit_after_err) = client.request(&state, "GET", &format!("/vms/{vm_id}/audit"), None).await;
    assert_eq!(audit_after_err.as_array().unwrap().len(), audit_count_before);

    // 6. Cloning a VM records audit event on cloned VM
    let (_, _add_back) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "ip_mappings": [{"public_ip": "203.0.113.10", "private_ip": "10.0.0.10"}],
        "network_precondition": cleared["network_precondition"]
    }))).await;
    let (status, cloned) = client.request(&state, "POST", &format!("/vms/{vm_id}/clone"), None).await;
    assert_eq!(status, StatusCode::CREATED);
    let cloned_id = cloned["id"].as_str().unwrap();
    let (_, cloned_audit) = client.request(&state, "GET", &format!("/vms/{cloned_id}/audit"), None).await;
    let clone_mapping_event = cloned_audit.as_array().unwrap().iter().find(|e| e["field_name"] == "ip_mappings").expect("clone audit event for mappings");
    assert!(clone_mapping_event["old_value"].is_null());
    assert_eq!(clone_mapping_event["new_value"], "203.0.113.10>10.0.0.10");
}

#[tokio::test]
async fn api_network_precondition_concurrency_and_audit_integrity() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    // Create VM with networks and ip_mappings
    let (status, vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "precon-vm", "platform": "vmware", "cluster": "prod", "status": "running",
        "criticality": "high", "cpu_cores": 2, "memory_mb": 4096,
        "networks": [
            {"ip_address": "203.0.113.10", "role": "public"},
            {"ip_address": "10.0.0.10", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.10", "private_ip": "10.0.0.10"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::CREATED);
    let vm_id = vm["id"].as_str().unwrap();

    // Verify preconditions are exposed on VM
    let initial_precon = vm["network_precondition"].as_str().expect("network_precondition should be present");
    assert!(!initial_precon.is_empty());
    assert_eq!(vm["mapping_precondition"].as_str().unwrap(), initial_precon);

    let (_, audit_before) = client.request(&state, "GET", &format!("/vms/{vm_id}/audit"), None).await;
    let audit_count_before = audit_before.as_array().unwrap().len();

    // 1. Missing precondition token on mapping edit returns 409 Conflict
    let (status, err_missing) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "description": "should not save",
        "ip_mappings": []
    }))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(err_missing["detail"].as_str().unwrap().contains("reload the VM"));

    // 2. Mismatched precondition token returns 409 Conflict
    let (status, err_mismatch) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "description": "should not save either",
        "network_precondition": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "ip_mappings": []
    }))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(err_mismatch["detail"].as_str().unwrap().contains("reload the VM"));

    // Verify VM fields and audit log remained completely untouched
    let (_, vm_check) = client.request(&state, "GET", &format!("/vms/{vm_id}"), None).await;
    assert_eq!(vm_check["description"], Value::Null);
    assert_eq!(vm_check["ip_mappings"], json!([{"public_ip": "203.0.113.10", "private_ip": "10.0.0.10"}]));
    let (_, audit_after) = client.request(&state, "GET", &format!("/vms/{vm_id}/audit"), None).await;
    assert_eq!(audit_after.as_array().unwrap().len(), audit_count_before);

    // 3. Matching precondition token succeeds
    let (status, patched) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "description": "successfully updated",
        "network_precondition": initial_precon,
        "ip_mappings": []
    }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(patched["description"], "successfully updated");
    assert_eq!(patched["ip_mappings"], json!([]));
    assert_ne!(patched["network_precondition"], initial_precon);
}

#[tokio::test]
async fn api_creation_and_legacy_patch_without_precondition() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    // Creation with mappings requires no precondition
    let (status, vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "legacy-compat-vm", "platform": "vmware", "cluster": "prod", "status": "running",
        "criticality": "low", "cpu_cores": 1, "memory_mb": 1024,
        "networks": [
            {"ip_address": "203.0.113.25", "role": "public"},
            {"ip_address": "10.0.0.25", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.25", "private_ip": "10.0.0.25"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::CREATED);
    let vm_id = vm["id"].as_str().unwrap();

    // Legacy network-only PATCH (omitting ip_mappings) succeeds without precondition
    let (status, net_patch) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "networks": [
            {"ip_address": "203.0.113.25", "role": "public"},
            {"ip_address": "10.0.0.25", "role": "private"},
            {"ip_address": "10.0.0.26", "role": "private"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(net_patch["ip_mappings"], json!([{"public_ip": "203.0.113.25", "private_ip": "10.0.0.25"}]));

    // PATCH omitting both networks and ip_mappings preserves mappings without precondition
    let (status, desc_patch) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "description": "field-only update"
    }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(desc_patch["description"], "field-only update");
    assert_eq!(desc_patch["ip_mappings"], json!([{"public_ip": "203.0.113.25", "private_ip": "10.0.0.25"}]));
}

#[tokio::test]
async fn api_child_network_edits_invalidate_precondition() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    let (status, vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "child-precon-vm", "platform": "vmware", "cluster": "prod", "status": "running",
        "criticality": "medium", "cpu_cores": 2, "memory_mb": 2048,
        "networks": [
            {"ip_address": "203.0.113.55", "role": "public"},
            {"ip_address": "10.0.0.55", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.55", "private_ip": "10.0.0.55"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::CREATED);
    let vm_id = vm["id"].as_str().unwrap();
    let initial_precon = vm["network_precondition"].as_str().unwrap();

    // Add a child network directly via child endpoint
    let (status, new_child) = client.request(&state, "POST", &format!("/vms/{vm_id}/networks"), Some(json!({
        "ip_address": "10.0.0.56",
        "role": "private"
    }))).await;
    assert_eq!(status, StatusCode::CREATED, "{new_child}");

    // Detail query exposes updated precondition
    let (status, vm_reloaded) = client.request(&state, "GET", &format!("/vms/{vm_id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    let updated_precon = vm_reloaded["network_precondition"].as_str().unwrap();
    assert_ne!(initial_precon, updated_precon, "Child network addition must alter precondition token");

    // Attempting to save with stale initial precondition fails with 409 Conflict
    let (status, err) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "network_precondition": initial_precon,
        "ip_mappings": []
    }))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(err["detail"].as_str().unwrap().contains("reload the VM"));

    // Saving with updated precondition succeeds
    let (status, ok) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "network_precondition": updated_precon,
        "ip_mappings": []
    }))).await;
    assert_eq!(status, StatusCode::OK, "{ok}");
}

#[tokio::test]
async fn api_malformed_ipv4_rejected_and_cidr_normalized() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    // 1. Create with malformed IPv4 rejected at API boundary
    for bad_ip in ["256.1.1.1", "1.2.3", "not-an-ip", "::1", "10.0.0.1:80"] {
        let (status, err) = client.request(&state, "POST", "/vms", Some(json!({
            "name": "bad-ip-vm", "platform": "vmware", "cluster": "prod", "status": "running",
            "criticality": "low", "cpu_cores": 1, "memory_mb": 1024,
            "ip_mappings": [
                {"public_ip": bad_ip, "private_ip": "10.0.0.1"}
            ]
        }))).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "Expected rejection for bad IP: {bad_ip}");
        let detail = err["detail"].as_array().unwrap();
        assert!(detail.iter().any(|e| e["loc"] == json!(["body", "ip_mappings", 0, "public_ip"])));
    }

    // 2. Valid IPv4 with CIDR notation and whitespace normalized and accepted
    let (status, vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "cidr-norm-vm", "platform": "vmware", "cluster": "prod", "status": "running",
        "criticality": "low", "cpu_cores": 1, "memory_mb": 1024,
        "networks": [
            {"ip_address": " 203.0.113.60/24 ", "role": "public"},
            {"ip_address": "  10.0.0.60/16  ", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": " 203.0.113.60/24 ", "private_ip": "  10.0.0.60/16  "}
        ]
    }))).await;
    assert_eq!(status, StatusCode::CREATED, "{vm}");
    assert_eq!(vm["networks"][0]["ip_address"], "203.0.113.60");
    assert_eq!(vm["networks"][1]["ip_address"], "10.0.0.60");
    assert_eq!(vm["ip_mappings"], json!([{"public_ip": "203.0.113.60", "private_ip": "10.0.0.60"}]));
}
