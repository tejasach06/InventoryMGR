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
        let name = format!("inventorymgr-csvmap-test-{}", Uuid::new_v4().simple());
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
                jwt_secret: "csvmap-regression-fixture-key-not-production".into(),
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

    async fn request_raw(&mut self, state: &AppState, method: &str, path: &str) -> (StatusCode, Vec<u8>) {
        let app = crate::api::auth::router()
            .merge(crate::api::accounts::router())
            .merge(crate::api::inventory::router())
            .merge(crate::api::auxiliary::router())
            .with_state(state.clone());
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::COOKIE, &self.cookie)
            .header("x-csrf-token", &self.csrf)
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 10 * 1024 * 1024).await.unwrap();
        (status, bytes.to_vec())
    }

    async fn upload_csv(&mut self, state: &AppState, filename: &str, csv_text: &str, full_inventory: bool) -> (StatusCode, Value) {
        let app = crate::api::auth::router()
            .merge(crate::api::accounts::router())
            .merge(crate::api::inventory::router())
            .merge(crate::api::auxiliary::router())
            .with_state(state.clone());
        let boundary = "------------------------Boundary1234567890";
        let mut body = Vec::new();
        if full_inventory {
            body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"full_inventory\"\r\n\r\ntrue\r\n").as_bytes());
        }
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: text/csv\r\n\r\n{csv_text}\r\n--{boundary}--\r\n").as_bytes());

        let request = Request::builder()
            .method("POST")
            .uri("/imports/preview")
            .header(header::COOKIE, &self.cookie)
            .header("x-csrf-token", &self.csrf)
            .header(header::CONTENT_TYPE, format!("multipart/form-data; boundary={boundary}"))
            .body(Body::from(body))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }
}

async fn setup_client(state: &AppState) -> Browser {
    let mut client = Browser::default();
    let (status, _) = client.request(state, "POST", "/auth/setup", Some(json!({
        "email": "admin@example.com",
        "password": "admin-password"
    }))).await;
    assert_eq!(status, StatusCode::CREATED);
    client
}

#[tokio::test]
async fn test_csv_legacy_compatibility_and_preservation() {
    let (_db, state) = Database::start().await;
    let mut client = setup_client(&state).await;

    // 1. Create a VM via legacy CSV without ip_mappings column
    let legacy_csv = "name,platform,cluster,status,cpu_cores,memory_mb,criticality,public_ip,private_ip\n\
                      legacy-vm,vmware,cluster-a,running,2,4096,medium,203.0.113.10,10.0.0.10\n";
    let (status, preview) = client.upload_csv(&state, "legacy.csv", legacy_csv, false).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(preview["summary"]["create"], 1);
    let batch_id = preview["id"].as_str().unwrap();

    let (status, commit) = client.request(&state, "POST", &format!("/imports/{batch_id}/commit"), None).await;
    assert_eq!(status, StatusCode::OK, "Legacy CSV commit succeeded: {commit:?}");

    // Get the created VM ID
    let (_, list) = client.request(&state, "GET", "/vms", None).await;
    let vm_id = list["items"][0]["id"].as_str().unwrap();

    // Add mapping via API
    let (status, patched) = client.request(&state, "PATCH", &format!("/vms/{vm_id}"), Some(json!({
        "ip_mappings": [{"public_ip": "203.0.113.10", "private_ip": "10.0.0.10"}]
    }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(patched["ip_mappings"], json!([{"public_ip": "203.0.113.10", "private_ip": "10.0.0.10"}]));

    // Re-import legacy CSV updating owner; mapping MUST be preserved
    let reimport_csv = "name,platform,cluster,status,cpu_cores,memory_mb,criticality,owner\n\
                        legacy-vm,vmware,cluster-a,running,2,4096,medium,infra-team\n";
    let (status, preview2) = client.upload_csv(&state, "reimport.csv", reimport_csv, false).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(preview2["summary"]["update"], 1);
    let batch2_id = preview2["id"].as_str().unwrap();

    let (status, _) = client.request(&state, "POST", &format!("/imports/{batch2_id}/commit"), None).await;
    assert_eq!(status, StatusCode::OK);

    let (_, check_vm) = client.request(&state, "GET", &format!("/vms/{vm_id}"), None).await;
    assert_eq!(check_vm["owner"], "infra-team");
    assert_eq!(check_vm["ip_mappings"], json!([{"public_ip": "203.0.113.10", "private_ip": "10.0.0.10"}]), "Existing mapping preserved on legacy update");
}

#[tokio::test]
async fn test_csv_malformed_syntax_blocks_batch() {
    let (_db, state) = Database::start().await;
    let mut client = setup_client(&state).await;

    let malformed_csv = "name,platform,cluster,status,cpu_cores,memory_mb,criticality,public_ip,private_ip,ip_mappings\n\
                         vm-bad,vmware,cluster-a,running,2,4096,medium,203.0.113.1,10.0.0.1,not-a-valid-pair\n";
    let (status, preview) = client.upload_csv(&state, "bad.csv", malformed_csv, false).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(preview["summary"]["invalid"], 1);
    assert_eq!(preview["rows"][0]["errors"][0]["field"], "ip_mappings");

    let batch_id = preview["id"].as_str().unwrap();
    let (status, err) = client.request(&state, "POST", &format!("/imports/{batch_id}/commit"), None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(err["detail"].as_str().unwrap().contains("invalid or conflicting rows"));
}

#[tokio::test]
async fn test_csv_role_unresolved_and_ambiguous_collisions() {
    let (_db, state) = Database::start().await;
    let mut client = setup_client(&state).await;

    // 1. Wrong role: using private IP as public endpoint
    let wrong_role_csv = "name,platform,cluster,status,cpu_cores,memory_mb,criticality,public_ip,private_ip,ip_mappings\n\
                          vm-role,vmware,cluster-a,running,2,4096,medium,203.0.113.1,10.0.0.1,10.0.0.1>10.0.0.1\n";
    let (status, preview) = client.upload_csv(&state, "wrong_role.csv", wrong_role_csv, false).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(preview["summary"]["invalid"], 1);
    assert!(preview["rows"][0]["errors"][0]["message"].as_str().unwrap().contains("has role 'private', expected 'public'"));

    // 2. Unresolved endpoint: address not on VM
    let unres_csv = "name,platform,cluster,status,cpu_cores,memory_mb,criticality,public_ip,private_ip,ip_mappings\n\
                     vm-unres,vmware,cluster-a,running,2,4096,medium,203.0.113.1,10.0.0.1,203.0.113.1>192.168.99.99\n";
    let (status, preview2) = client.upload_csv(&state, "unres.csv", unres_csv, false).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(preview2["summary"]["invalid"], 1);
    assert!(preview2["rows"][0]["errors"][0]["message"].as_str().unwrap().contains("does not match any network entry"));

    // 3. Ambiguous address: VM has two public networks with the same IP
    let (status, _created_vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "vm-ambig",
        "platform": "vmware",
        "cluster": "cluster-a",
        "status": "running",
        "cpu_cores": 2,
        "memory_mb": 4096,
        "criticality": "medium",
        "networks": [
            {"ip_address": "203.0.113.5", "role": "public"},
            {"ip_address": "203.0.113.5", "role": "public"},
            {"ip_address": "10.0.0.5", "role": "private"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::CREATED);

    let amb_csv = "name,platform,cluster,ip_mappings\n\
                   vm-ambig,vmware,cluster-a,203.0.113.5>10.0.0.5\n";
    let (status, preview3) = client.upload_csv(&state, "ambig.csv", amb_csv, false).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(preview3["summary"]["invalid"], 1);
    assert!(preview3["rows"][0]["errors"][0]["message"].as_str().unwrap().contains("Ambiguous public address '203.0.113.5'"));
}

#[tokio::test]
async fn test_csv_multiple_targets_and_shared_private() {
    let (_db, state) = Database::start().await;
    let mut client = setup_client(&state).await;

    // One public to multiple privates, plus multiple publics to same private
    let csv = "name,platform,cluster,status,cpu_cores,memory_mb,criticality,public_ip,private_ip,ip_mappings\n\
               vm-multi,vmware,cluster-a,running,2,4096,medium,203.0.113.1;203.0.113.2,10.0.0.1;10.0.0.2,203.0.113.1>10.0.0.1;203.0.113.1>10.0.0.2;203.0.113.2>10.0.0.1\n";
    let (status, preview) = client.upload_csv(&state, "multi.csv", csv, false).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(preview["summary"]["create"], 1);
    let batch_id = preview["id"].as_str().unwrap();

    let (status, _) = client.request(&state, "POST", &format!("/imports/{batch_id}/commit"), None).await;
    assert_eq!(status, StatusCode::OK);

    let (_, list) = client.request(&state, "GET", "/vms", None).await;
    let vm = &list["items"][0];
    let expected = json!([
        {"public_ip": "203.0.113.1", "private_ip": "10.0.0.1"},
        {"public_ip": "203.0.113.1", "private_ip": "10.0.0.2"},
        {"public_ip": "203.0.113.2", "private_ip": "10.0.0.1"}
    ]);
    assert_eq!(vm["ip_mappings"], expected);
}

#[tokio::test]
async fn test_csv_add_blank_reimport_and_idempotency() {
    let (_db, state) = Database::start().await;
    let mut client = setup_client(&state).await;

    // 1. Initial import with 1 mapping
    let csv1 = "name,platform,cluster,status,cpu_cores,memory_mb,criticality,public_ip,private_ip,ip_mappings\n\
                vm-idem,vmware,cluster-a,running,2,4096,medium,203.0.113.1,10.0.0.1;10.0.0.2,203.0.113.1>10.0.0.1\n";
    let (status, preview1) = client.upload_csv(&state, "step1.csv", csv1, false).await;
    assert_eq!(status, StatusCode::CREATED);
    let batch1 = preview1["id"].as_str().unwrap();
    assert_eq!(client.request(&state, "POST", &format!("/imports/{batch1}/commit"), None).await.0, StatusCode::OK);

    // 2. Re-import with the same mapping: row is unchanged, commit is idempotent
    let csv2 = "name,platform,cluster,public_ip,private_ip,ip_mappings\n\
                vm-idem,vmware,cluster-a,203.0.113.1,10.0.0.1;10.0.0.2,203.0.113.1>10.0.0.1\n";
    let (status, preview2) = client.upload_csv(&state, "step2.csv", csv2, false).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(preview2["summary"]["unchanged"], 1, "Same mapping is marked unchanged");
    let batch2 = preview2["id"].as_str().unwrap();
    assert_eq!(client.request(&state, "POST", &format!("/imports/{batch2}/commit"), None).await.0, StatusCode::OK);

    // 3. Re-import adding an additional mapping: specified pair added idempotently without removing existing
    let csv3 = "name,platform,cluster,public_ip,private_ip,ip_mappings\n\
                vm-idem,vmware,cluster-a,203.0.113.1,10.0.0.1;10.0.0.2,203.0.113.1>10.0.0.2\n";
    let (status, preview3) = client.upload_csv(&state, "step3.csv", csv3, false).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(preview3["summary"]["update"], 1);
    assert_eq!(preview3["rows"][0]["changes"]["ip_mappings"][1], json!(["203.0.113.1>10.0.0.2"]));
    let batch3 = preview3["id"].as_str().unwrap();
    assert_eq!(client.request(&state, "POST", &format!("/imports/{batch3}/commit"), None).await.0, StatusCode::OK);

    let (_, list) = client.request(&state, "GET", "/vms", None).await;
    let vm = &list["items"][0];
    assert_eq!(vm["ip_mappings"], json!([
        {"public_ip": "203.0.113.1", "private_ip": "10.0.0.1"},
        {"public_ip": "203.0.113.1", "private_ip": "10.0.0.2"}
    ]));
}

#[tokio::test]
async fn test_csv_protected_retargets() {
    let (_db, state) = Database::start().await;
    let mut client = setup_client(&state).await;

    // Create VM with public IP 203.0.113.1 (mapped to 10.0.0.1), private 10.0.0.1 (mapped), and unmapped private 10.0.0.2
    let (status, vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "vm-protect",
        "platform": "vmware",
        "cluster": "cluster-a",
        "status": "running",
        "cpu_cores": 2,
        "memory_mb": 4096,
        "criticality": "medium",
        "networks": [
            {"ip_address": "203.0.113.1", "role": "public"},
            {"ip_address": "10.0.0.1", "role": "private"},
            {"ip_address": "10.0.0.2", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.1", "private_ip": "10.0.0.1"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::CREATED);
    let vm_id = vm["id"].as_str().unwrap();

    // Import with new private IP 10.0.0.3.
    // 10.0.0.1 is mapped, so it must be protected from retargeting!
    // 10.0.0.2 is unlinked, so it should be retargeted to 10.0.0.3.
    let csv = "name,platform,cluster,private_ip\n\
               vm-protect,vmware,cluster-a,10.0.0.3\n";
    let (status, preview) = client.upload_csv(&state, "protect.csv", csv, false).await;
    assert_eq!(status, StatusCode::CREATED);
    let batch = preview["id"].as_str().unwrap();
    assert_eq!(client.request(&state, "POST", &format!("/imports/{batch}/commit"), None).await.0, StatusCode::OK);

    let (_, check_vm) = client.request(&state, "GET", &format!("/vms/{vm_id}"), None).await;
    // 10.0.0.1 and 203.0.113.1 are still mapped together!
    assert_eq!(check_vm["ip_mappings"], json!([{"public_ip": "203.0.113.1", "private_ip": "10.0.0.1"}]));
    let net_ips: Vec<_> = check_vm["networks"].as_array().unwrap().iter().map(|n| n["ip_address"].as_str().unwrap()).collect();
    assert!(net_ips.contains(&"10.0.0.1"));
    assert!(net_ips.contains(&"10.0.0.3"));
    assert!(!net_ips.contains(&"10.0.0.2"), "Unlinked 10.0.0.2 was retargeted to 10.0.0.3");
}

#[tokio::test]
async fn test_csv_stale_preview_rejection_and_rollback() {
    let (_db, state) = Database::start().await;
    let mut client = setup_client(&state).await;

    // 1. Create VM
    let (status, vm) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "vm-stale",
        "platform": "vmware",
        "cluster": "cluster-a",
        "status": "running",
        "cpu_cores": 2,
        "memory_mb": 4096,
        "criticality": "medium",
        "networks": [
            {"ip_address": "203.0.113.20", "role": "public"},
            {"ip_address": "10.0.0.20", "role": "private"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::CREATED);
    let vm_id = vm["id"].as_str().unwrap();

    // 2. Preview an import that maps 203.0.113.20>10.0.0.20
    let csv = "name,platform,cluster,ip_mappings\n\
               vm-stale,vmware,cluster-a,203.0.113.20>10.0.0.20\n";
    let (status, preview) = client.upload_csv(&state, "stale.csv", csv, false).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(preview["summary"]["update"], 1);
    let batch_id = preview["id"].as_str().unwrap();

    // 3. Concurrently delete the private network row before commit!
    let net_id = vm["networks"][1]["id"].as_str().unwrap();
    let (status, _) = client.request(&state, "DELETE", &format!("/vms/{vm_id}/networks/{net_id}"), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // 4. Commit must fail with CONFLICT (preview is stale)
    let (status, err) = client.request(&state, "POST", &format!("/imports/{batch_id}/commit"), None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(err["detail"].as_str().unwrap().contains("preview is stale"));

    // 5. Test unchanged row revalidation:
    // Create mapping on VM, preview CSV having that same mapping (marked unchanged).
    // Concurrently delete network endpoint, commit must fail with CONFLICT.
    let (status, vm2) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "vm-unchanged-stale",
        "platform": "vmware",
        "cluster": "cluster-a",
        "status": "running",
        "cpu_cores": 2,
        "memory_mb": 4096,
        "criticality": "medium",
        "networks": [
            {"ip_address": "203.0.113.30", "role": "public"},
            {"ip_address": "10.0.0.30", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.30", "private_ip": "10.0.0.30"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::CREATED);
    let vm2_id = vm2["id"].as_str().unwrap();

    let csv_unchanged = "name,platform,cluster,ip_mappings\n\
                         vm-unchanged-stale,vmware,cluster-a,203.0.113.30>10.0.0.30\n";
    let (status, preview_unchanged) = client.upload_csv(&state, "unchanged_stale.csv", csv_unchanged, false).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(preview_unchanged["summary"]["unchanged"], 1);
    let batch_unchanged_id = preview_unchanged["id"].as_str().unwrap();

    // Atomically unlink and clear endpoints via VM patch
    let (status, _) = client.request(&state, "PATCH", &format!("/vms/{vm2_id}"), Some(json!({
        "networks": [],
        "ip_mappings": []
    }))).await;
    assert_eq!(status, StatusCode::OK);

    // Commit of unchanged batch must detect stale preview and fail with CONFLICT
    let (status, err) = client.request(&state, "POST", &format!("/imports/{batch_unchanged_id}/commit"), None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(err["detail"].as_str().unwrap().contains("preview is stale"));
}

#[tokio::test]
async fn test_full_export_and_reimport_round_trip() {
    let (_db, state) = Database::start().await;
    let mut client = setup_client(&state).await;

    // Create VM with IP mapping
    let (status, _created) = client.request(&state, "POST", "/vms", Some(json!({
        "name": "vm-export-rt",
        "platform": "proxmox",
        "cluster": "cluster-rt",
        "external_id": "rt-101",
        "status": "running",
        "cpu_cores": 4,
        "memory_mb": 8192,
        "criticality": "high",
        "networks": [
            {"ip_address": "203.0.113.50", "role": "public"},
            {"ip_address": "10.0.0.50", "role": "private"}
        ],
        "ip_mappings": [
            {"public_ip": "203.0.113.50", "private_ip": "10.0.0.50"}
        ]
    }))).await;
    assert_eq!(status, StatusCode::CREATED);

    // Export CSV
    let (status, csv_bytes) = client.request_raw(&state, "GET", "/vms/export?format=csv").await;
    assert_eq!(status, StatusCode::OK);
    let csv_str = String::from_utf8(csv_bytes).unwrap();
    assert!(csv_str.contains("ip_mappings"), "Export CSV contains ip_mappings header");
    assert!(csv_str.contains("203.0.113.50>10.0.0.50"), "Export CSV contains canonical mapping pair");
    assert!(csv_str.contains("203.0.113.50"), "Export CSV contains public_ip");
    assert!(csv_str.contains("10.0.0.50"), "Export CSV contains private_ip");

    // Modify exported CSV to create a new VM
    let new_csv = csv_str.replace("vm-export-rt", "vm-imported-clone").replace("rt-101", "rt-102");

    // Import exported CSV
    let (status, preview) = client.upload_csv(&state, "round_trip.csv", &new_csv, false).await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(preview["summary"]["create"].as_i64().unwrap() >= 1);
    let batch_id = preview["id"].as_str().unwrap();

    let (status, _) = client.request(&state, "POST", &format!("/imports/{batch_id}/commit"), None).await;
    assert_eq!(status, StatusCode::OK);

    // Verify imported VM has the mappings
    let (_, list) = client.request(&state, "GET", "/vms", None).await;
    let imported_vm = list["items"].as_array().unwrap().iter().find(|vm| vm["name"] == "vm-imported-clone").expect("imported VM found");
    assert_eq!(imported_vm["ip_mappings"], json!([{"public_ip": "203.0.113.50", "private_ip": "10.0.0.50"}]));
}

#[tokio::test]
async fn test_csv_batch_mapping_limit_and_audit() {
    let (_db, state) = Database::start().await;
    let mut client = Browser::default();
    client.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await;

    // 1. Batch limit: 5001 mapping pairs across rows rejected with 400 Bad Request
    let mut big_csv = String::from("name,platform,cluster,status,cpu_cores,memory_mb,public_ip,private_ip,ip_mappings\n");
    let many_pairs = (0..5001).map(|i| format!("203.0.113.{}>10.0.0.{}", i % 250, i % 250)).collect::<Vec<_>>().join(";");
    big_csv.push_str(&format!("over-limit-batch,vmware,c,running,1,1024,203.0.113.1,10.0.0.1,{many_pairs}\n"));
    let (status, err) = client.upload_csv(&state, "big.csv", &big_csv, false).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(err["detail"].as_str().unwrap().contains("exceeds limit of 5000 IP mapping pairs"));

    // 2. Normal import records audit log event
    let csv = "name,platform,cluster,status,cpu_cores,memory_mb,public_ip,private_ip,ip_mappings\n\
               csv-audit-vm,vmware,c,running,1,1024,203.0.113.10,10.0.0.10,203.0.113.10>10.0.0.10\n";
    let (status, preview) = client.upload_csv(&state, "audit_test.csv", csv, false).await;
    assert_eq!(status, StatusCode::CREATED);
    let batch_id = preview["id"].as_str().unwrap();

    let (status, _) = client.request(&state, "POST", &format!("/imports/{batch_id}/commit"), None).await;
    assert_eq!(status, StatusCode::OK);

    let (_, list) = client.request(&state, "GET", "/vms", None).await;
    let vm = list["items"].as_array().unwrap().iter().find(|vm| vm["name"] == "csv-audit-vm").unwrap();
    let vm_id = vm["id"].as_str().unwrap();

    let (status, audit) = client.request(&state, "GET", &format!("/vms/{vm_id}/audit"), None).await;
    assert_eq!(status, StatusCode::OK);
    let mapping_event = audit.as_array().unwrap().iter().find(|e| e["field_name"] == "ip_mappings").expect("audit entry for CSV mapping");
    assert_eq!(mapping_event["new_value"], "203.0.113.10>10.0.0.10");

    // 3. Re-importing without mapping changes records NO spurious audit log entry
    let (status, preview2) = client.upload_csv(&state, "audit_test_repeat.csv", csv, false).await;
    assert_eq!(status, StatusCode::CREATED);
    let batch_id2 = preview2["id"].as_str().unwrap();
    let (status, _) = client.request(&state, "POST", &format!("/imports/{batch_id2}/commit"), None).await;
    assert_eq!(status, StatusCode::OK);

    let (_, audit_after) = client.request(&state, "GET", &format!("/vms/{vm_id}/audit"), None).await;
    let mapping_count_after = audit_after.as_array().unwrap().iter().filter(|e| e["field_name"] == "ip_mappings").count();
    let mapping_count_before = audit.as_array().unwrap().iter().filter(|e| e["field_name"] == "ip_mappings").count();
    assert_eq!(mapping_count_after, mapping_count_before, "No spurious audit event for unchanged import");
}
