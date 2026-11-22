use super::*;
use axum::{body::{to_bytes, Body}, http::Request};
use crate::core::config::Settings;
use serde_json::{json, Value};
use std::{process::Command, sync::Arc};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};
use tower::ServiceExt;

struct Database(String);
impl Database {
    fn command(args: &[&str]) -> String {
        let result = Command::new("podman").args(args).output().expect("podman is required for isolated auth tests");
        assert!(result.status.success(), "podman failed: {}", String::from_utf8_lossy(&result.stderr));
        String::from_utf8(result.stdout).unwrap().trim().to_owned()
    }
    async fn start() -> (Self, AppState) {
        let name = format!("inventorymgr-auth-test-{}", Uuid::new_v4().simple());
        Self::command(&["run", "--detach", "--rm", "--name", &name, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "docker.io/library/postgres:17-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27"]);
        let database = Self(name);
        let binding = Self::command(&["port", &database.0, "5432/tcp"]);
        let port = binding.rsplit(':').next().unwrap();
        let url = format!("postgresql://postgres@127.0.0.1:{port}/postgres");
        let deadline = Instant::now() + Duration::from_secs(30);
        let pool = loop {
            match sqlx::postgres::PgPoolOptions::new().acquire_timeout(Duration::from_secs(1)).connect(&url).await {
                Ok(pool) => break pool,
                Err(_) if Instant::now() < deadline => tokio::time::sleep(Duration::from_millis(50)).await,
                Err(error) => panic!("Disposable PostgreSQL did not start: {error}"),
            }
        };
        crate::db::migrate(&pool).await.unwrap();
        let state = AppState {
            pool,
            settings: Arc::new(Settings {
                app_env: "test".into(), database_url: url, jwt_secret: "auth-regression-fixture-key-not-production".into(),
                session_cookie_name: "session".into(), csrf_cookie_name: "csrf".into(), secure_cookies: false,
                cors_origins: Vec::new(), backup_dir: format!("/tmp/{}", database.0), pg_bin_dir: String::new(),
                host: "127.0.0.1".into(), port: 0,
            }),
            database_access: Arc::new(tokio::sync::RwLock::new(())),
        };
        (database, state)
    }
}
impl Drop for Database {
    fn drop(&mut self) { Self::command(&["rm", "--force", &self.0]); }
}

#[derive(Default, Clone)]
struct Browser { cookie: String, csrf: String }
impl Browser {
    async fn request(&mut self, state: &AppState, method: &str, path: &str, payload: Option<Value>) -> (StatusCode, Value) {
        let app = router().merge(crate::api::accounts::router())
            .merge(crate::api::inventory::router()).merge(crate::api::auxiliary::router()).with_state(state.clone());
        let mut request = Request::builder().method(method).uri(path).header(header::COOKIE, &self.cookie).header("x-csrf-token", &self.csrf);
        let body = if let Some(payload) = payload {
            request = request.header(header::CONTENT_TYPE, "application/json");
            Body::from(payload.to_string())
        } else { Body::empty() };
        let response = app.oneshot(request.body(body).unwrap()).await.unwrap();
        let status = response.status();
        let cookies: Vec<_> = response.headers().get_all(header::SET_COOKIE).iter().map(|v| v.to_str().unwrap().split(';').next().unwrap().to_owned()).collect();
        if !cookies.is_empty() {
            self.csrf = cookies.iter().find_map(|c| c.strip_prefix("csrf=")).unwrap_or("").to_owned();
            self.cookie = cookies.join("; ");
        }
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
    }
    async fn login(&mut self, state: &AppState, email: &str, password: &str) -> StatusCode {
        self.request(state, "POST", "/auth/login", Some(json!({"email":email,"password":password}))).await.0
    }
}

#[tokio::test]
#[ignore = "requires Podman; creates and removes its own PostgreSQL 17 container"]
async fn bulk_delete_vms_requires_admin_and_csrf_and_deletes_atomically() {
    let (_database, state) = Database::start().await;
    let mut admin = Browser::default();
    let (status, _) = admin.request(&state, "POST", "/auth/setup", Some(json!({
        "email": "admin@example.com", "password": "admin-password",
    }))).await;
    assert_eq!(status, StatusCode::CREATED);

    let mut ids = Vec::new();
    for name in ["first", "second", "untouched"] {
        let (status, vm) = admin.request(&state, "POST", "/vms", Some(json!({
            "name": name, "platform": "vmware", "cluster": "test", "status": "running",
            "criticality": "medium", "cpu_cores": 1, "memory_mb": 1024,
            "disks": [{"disk_name": "root"}],
        }))).await;
        assert_eq!(status, StatusCode::CREATED, "{vm}");
        ids.push(Uuid::parse_str(vm["id"].as_str().unwrap()).unwrap());
    }
    let targets = &ids[..2];
    let path = "/vms/bulk-delete";
    let payload = json!({"ids": targets});
    let mut anonymous = Browser::default();
    assert_eq!(anonymous.request(&state, "POST", path, Some(payload.clone())).await.0, StatusCode::UNAUTHORIZED);
    for role in ["viewer", "editor"] {
        let email = format!("{role}@example.com");
        let (status, _) = admin.request(&state, "POST", "/users", Some(json!({
            "email": email, "password": "user-password", "role": role,
        }))).await;
        assert_eq!(status, StatusCode::CREATED);
        let mut user = Browser::default();
        assert_eq!(user.login(&state, &email, "user-password").await, StatusCode::OK);
        assert_eq!(user.request(&state, "POST", path, Some(payload.clone())).await.0, StatusCode::FORBIDDEN);
    }
    let mut without_csrf = admin.clone();
    without_csrf.csrf.clear();
    assert_eq!(without_csrf.request(&state, "POST", path, Some(payload.clone())).await.0, StatusCode::FORBIDDEN);

    let missing: Vec<_> = (0..201).map(Uuid::from_u128).collect();
    for invalid in [
        None,
        Some(json!({})),
        Some(json!([[ids[0]]])),
        Some(json!({"ids": null})),
        Some(json!({"ids": ids[0]})),
        Some(json!({"ids": []})),
        Some(json!({"ids": ["not-a-uuid"]})),
        Some(json!({"ids": [123]})),
        Some(json!({"ids": [ids[0], ids[0].simple().to_string().to_uppercase()]})),
        Some(json!({"ids": [ids[0]], "all": true})),
        Some(json!({"ids": [ids[0]], "request_id": "not-a-uuid"})),
        Some(json!({"ids": [ids[0]], "version": 123})),
        Some(json!({"ids": missing})),
    ] {
        let (status, body) = admin.request(&state, "POST", path, invalid.clone()).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{invalid:?}: {body}");
    }
    let upper_bound = json!({"ids": &missing[..200]});
    assert_eq!(admin.request(&state, "POST", path, Some(upper_bound)).await.0, StatusCode::CONFLICT);

    let stale = json!({"ids": [ids[0], missing[0], ids[1]]});
    assert_eq!(admin.request(&state, "POST", path, Some(stale)).await.0, StatusCode::CONFLICT);
    for id in &ids {
        let (status, vm) = admin.request(&state, "GET", &format!("/vms/{id}"), None).await;
        assert_eq!(status, StatusCode::OK, "{id}");
        assert_eq!(vm["disks"].as_array().unwrap().len(), 1, "{id}");
    }

    sqlx::query("CREATE TABLE delete_blocker (vm_id uuid REFERENCES vms(id))")
        .execute(&state.pool).await.unwrap();
    sqlx::query("INSERT INTO delete_blocker (vm_id) VALUES ($1)")
        .bind(ids[1]).execute(&state.pool).await.unwrap();
    assert_eq!(admin.request(&state, "POST", path, Some(payload.clone())).await,
        (StatusCode::INTERNAL_SERVER_ERROR, json!({"detail":"VM deletion failed"})));
    let disk_count: i64 = sqlx::query_scalar("SELECT count(*) FROM vm_disks")
        .fetch_one(&state.pool).await.unwrap();
    assert_eq!(disk_count, 3);
    sqlx::query("DROP TABLE delete_blocker").execute(&state.pool).await.unwrap();

    assert_eq!(admin.request(&state, "POST", path, Some(payload)).await.0, StatusCode::NO_CONTENT);
    let remaining_vms: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM vms")
        .fetch_all(&state.pool).await.unwrap();
    let remaining_disks: Vec<Uuid> = sqlx::query_scalar("SELECT vm_id FROM vm_disks")
        .fetch_all(&state.pool).await.unwrap();
    assert_eq!(remaining_vms, [ids[2]]);
    assert_eq!(remaining_disks, [ids[2]]);
}

async fn deletion_test_vm(admin: &mut Browser, state: &AppState, name: &str) -> Uuid {
    let (status, vm) = admin.request(state, "POST", "/vms", Some(json!({
        "name": name, "platform": "vmware", "cluster": "test", "status": "running",
        "criticality": "medium", "cpu_cores": 1, "memory_mb": 1024,
    }))).await;
    assert_eq!(status, StatusCode::CREATED, "{vm}");
    Uuid::parse_str(vm["id"].as_str().unwrap()).unwrap()
}

#[tokio::test]
#[ignore = "requires Podman; creates and removes its own PostgreSQL 17 container"]
async fn vm_deletion_audit_is_atomic_and_replay_requires_current_authorization() {
    let (_database, state) = Database::start().await;
    let mut admin = Browser::default();
    assert_eq!(admin.request(&state, "POST", "/auth/setup", Some(json!({
        "email":"admin@example.com", "password":"admin-password",
    }))).await.0, StatusCode::CREATED);
    let actor: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = 'admin@example.com'")
        .fetch_one(&state.pool).await.unwrap();
    let first = deletion_test_vm(&mut admin, &state, "first").await;
    let second = deletion_test_vm(&mut admin, &state, "second").await;
    let single = deletion_test_vm(&mut admin, &state, "single").await;
    let single_path = format!("/vms/{single}");
    assert_eq!(admin.request(&state, "PATCH", &format!("/vms/{first}"), Some(json!({
        "description":"preserve this history",
    }))).await.0, StatusCode::OK);
    let history = || sqlx::query_scalar::<_, Value>(
        "SELECT to_jsonb(a) FROM audit_log a WHERE vm_id = $1 AND field_name = 'description'",
    ).bind(first).fetch_one(&state.pool);
    let prior_history = history().await.unwrap();

    let path = "/vms/bulk-delete";
    let request_id = Uuid::new_v4();
    let version = crate::api::deps::session_generation(&state).await.unwrap();
    let stale = json!({"ids":[first, Uuid::nil()], "request_id":request_id, "version":version});
    assert_eq!(admin.request(&state, "POST", path, Some(stale)).await.0, StatusCode::CONFLICT);
    let mut ids = [first, second];
    ids.sort_unstable();
    let payload = json!({"ids":[ids[1], ids[0]], "request_id":request_id, "version":version});

    sqlx::raw_sql(
        "CREATE FUNCTION fail_deletion_audit() RETURNS trigger LANGUAGE plpgsql AS
           $$ BEGIN RAISE EXCEPTION 'private audit failure details'; END $$;
         CREATE CONSTRAINT TRIGGER fail_deletion_audit AFTER INSERT ON vm_deletion_receipts
           DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_deletion_audit();"
    ).execute(&state.pool).await.unwrap();
    assert_eq!(admin.request(&state, "POST", path, Some(payload.clone())).await,
        (StatusCode::INTERNAL_SERVER_ERROR, json!({"detail":"VM deletion failed"})));
    let after_failure: i64 = sqlx::query_scalar("SELECT count(*) FROM vms")
        .fetch_one(&state.pool).await.unwrap();
    assert_eq!(after_failure, 3);
    let receipts: i64 = sqlx::query_scalar("SELECT count(*) FROM vm_deletion_receipts")
        .fetch_one(&state.pool).await.unwrap();
    assert_eq!(receipts, 0);
    assert_eq!(history().await.unwrap(), prior_history);
    sqlx::query("DROP TRIGGER fail_deletion_audit ON vm_deletion_receipts")
        .execute(&state.pool).await.unwrap();

    assert_eq!(admin.request(&state, "POST", path, Some(payload.clone())).await.0, StatusCode::NO_CONTENT);
    assert_eq!(admin.request(&state, "POST", path, Some(json!({
        "ids":ids, "request_id":request_id, "version":version,
    }))).await.0, StatusCode::NO_CONTENT);
    assert_eq!(history().await.unwrap(), prior_history);
    let receipt: (Uuid, Vec<Uuid>, bool) = sqlx::query_as(
        "SELECT actor_id, vm_ids, deleted_at <= now()
         FROM vm_deletion_receipts WHERE operation_id = $1",
    ).bind(request_id).fetch_one(&state.pool).await.unwrap();
    assert_eq!(receipt, (actor, ids.to_vec(), true));

    let (status, mismatch) = admin.request(&state, "POST", path, Some(json!({
        "ids":[single], "request_id":request_id, "version":version,
    }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(mismatch, json!({"detail":"Deletion request could not be applied"}));
    let mut no_csrf = admin.clone();
    no_csrf.csrf.clear();
    assert_eq!(no_csrf.request(&state, "POST", path, Some(payload.clone())).await.0, StatusCode::FORBIDDEN);
    assert_eq!(admin.request(&state, "POST", "/users", Some(json!({
        "email":"other@example.com", "password":"other-password", "role":"admin",
    }))).await.0, StatusCode::CREATED);
    let mut other = Browser::default();
    assert_eq!(other.login(&state, "other@example.com", "other-password").await, StatusCode::OK);
    assert_eq!(other.request(&state, "POST", path, Some(payload.clone())).await, (status, mismatch));

    assert_eq!(admin.request(&state, "DELETE", &single_path, None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(admin.request(&state, "DELETE", &single_path, None).await.0, StatusCode::NOT_FOUND);
    let single_receipt: Uuid = sqlx::query_scalar(
        "SELECT actor_id FROM vm_deletion_receipts WHERE vm_ids = ARRAY[$1]::uuid[]",
    ).bind(single).fetch_one(&state.pool).await.unwrap();
    assert_eq!(single_receipt, actor);

    sqlx::query("ALTER TABLE app_settings RENAME TO unavailable_settings")
        .execute(&state.pool).await.unwrap();
    for (method, url, body) in [
        ("POST", path, Some(payload.clone())),
        ("DELETE", single_path.as_str(), None),
    ] {
        assert_eq!(admin.request(&state, method, url, body).await,
            (StatusCode::INTERNAL_SERVER_ERROR, json!({"detail":"VM deletion failed"})));
    }
    sqlx::query("ALTER TABLE unavailable_settings RENAME TO app_settings")
        .execute(&state.pool).await.unwrap();
    sqlx::query("UPDATE users SET role = 'viewer' WHERE id = $1")
        .bind(actor).execute(&state.pool).await.unwrap();
    assert_eq!(admin.request(&state, "POST", path, Some(payload)).await.0, StatusCode::FORBIDDEN);
}

#[tokio::test]
#[ignore = "requires Podman; creates and removes its own PostgreSQL 17 container"]
async fn vm_deletion_retries_lock_timeout_and_serializes_concurrent_requests() {
    async fn wait_for_blocked_requests(state: &AppState, count: i64) {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let pending: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM pg_stat_activity
                     WHERE datname = current_database() AND wait_event_type = 'Lock'
                       AND (query LIKE 'INSERT INTO vm_deletion_receipts %'
                            OR query LIKE 'SELECT id FROM vms WHERE id = ANY%')",
                ).fetch_one(&state.pool).await.unwrap();
                if pending == count {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        }).await.expect("deletion requests should overlap");
    }

    let (_database, state) = Database::start().await;
    let mut admin = Browser::default();
    assert_eq!(admin.request(&state, "POST", "/auth/setup", Some(json!({
        "email":"admin@example.com", "password":"admin-password",
    }))).await.0, StatusCode::CREATED);
    let mut ids = [
        deletion_test_vm(&mut admin, &state, "one").await,
        deletion_test_vm(&mut admin, &state, "two").await,
        deletion_test_vm(&mut admin, &state, "three").await,
    ];
    ids.sort_unstable();
    let [shared, first, second] = ids;
    let mut blocker = state.pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM vms WHERE id = $1 FOR UPDATE")
        .bind(first).execute(&mut *blocker).await.unwrap();

    let path = "/vms/bulk-delete";
    let request_id = Uuid::new_v4();
    let other_id = Uuid::new_v4();
    let version = crate::api::deps::session_generation(&state).await.unwrap();
    let payload = json!({"ids":[shared, first], "request_id":request_id, "version":version});
    let started = Instant::now();
    let outcome = tokio::time::timeout(
        Duration::from_secs(9), admin.request(&state, "POST", path, Some(payload.clone())),
    ).await.unwrap();
    assert_eq!(outcome, (StatusCode::SERVICE_UNAVAILABLE, json!({"detail":"VM deletion is busy. Try again."})));
    assert!(started.elapsed() >= Duration::from_secs(5));

    let mut replay = admin.clone();
    let mut overlapping = admin.clone();
    let (original, (repeated, competing, ())) = tokio::join!(
        admin.request(&state, "POST", path, Some(payload)),
        async {
            // The original owns the lower UUID before it reaches the blocked row.
            wait_for_blocked_requests(&state, 1).await;
            tokio::join!(
                replay.request(&state, "POST", path, Some(json!({"ids":[first, shared], "request_id":request_id, "version":version}))),
                overlapping.request(&state, "POST", path, Some(json!({"ids":[second, shared], "request_id":other_id, "version":version}))),
                async {
                    wait_for_blocked_requests(&state, 3).await;
                    blocker.rollback().await.unwrap();
                },
            )
        },
    );
    assert_eq!(original.0, StatusCode::NO_CONTENT);
    assert_eq!(original, repeated);
    assert_eq!(competing.0, StatusCode::CONFLICT);
    let remaining: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM vms")
        .fetch_all(&state.pool).await.unwrap();
    assert_eq!(remaining, [second]);
    let receipts: Vec<Uuid> = sqlx::query_scalar("SELECT operation_id FROM vm_deletion_receipts")
        .fetch_all(&state.pool).await.unwrap();
    assert_eq!(receipts, [request_id]);
}

#[tokio::test]
#[ignore = "requires Podman; creates and removes its own PostgreSQL 17 container"]
async fn vm_deletion_rejects_delayed_retry_from_before_restore_and_accepts_fresh_confirmation() {
    let (_database, state) = Database::start().await;
    let mut admin = Browser::default();
    assert_eq!(admin.request(&state, "POST", "/auth/setup", Some(json!({
        "email":"admin@example.com", "password":"admin-password",
    }))).await.0, StatusCode::CREATED);

    let first = deletion_test_vm(&mut admin, &state, "alpha").await;
    let second = deletion_test_vm(&mut admin, &state, "beta").await;
    let mut ids = [first, second];
    ids.sort_unstable();

    // 1. Initial selection captures current version token from /vms
    let (status, list) = admin.request(&state, "GET", "/vms", None).await;
    assert_eq!(status, StatusCode::OK);
    let initial_version = list["version"].as_str().expect("version token in list response").to_owned();

    let request_id = Uuid::new_v4();
    let payload = json!({
        "ids": ids,
        "request_id": request_id,
        "version": initial_version,
    });

    // 2. Simulate database restore:
    // Under the restore concurrency gate (exclusive write lock),
    // restore updates app_settings with a new session_generation.
    {
        let _exclusive = state.database_access.write().await;
        crate::api::deps::invalidate_sessions(&state.pool).await.unwrap();
    }

    // 3. Admin logs in again to obtain a fresh valid admin session in the restored epoch
    assert_eq!(admin.login(&state, "admin@example.com", "admin-password").await, StatusCode::OK);

    // 4. Delayed retry with pre-restore request_id and pre-restore version MUST be rejected
    // with 409 Conflict without deleting the restored VMs
    let (status, err) = admin.request(&state, "POST", "/vms/bulk-delete", Some(payload)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(err, json!({"detail":"The selection is stale; please refresh and try again"}));

    // Verify restored VMs are NOT deleted
    let vm_count: i64 = sqlx::query_scalar("SELECT count(*) FROM vms WHERE id = ANY($1)")
        .bind(&ids[..]).fetch_one(&state.pool).await.unwrap();
    assert_eq!(vm_count, 2, "Restored VMs must be preserved against pre-restore retries");

    // 5. Fresh confirmation: Admin fetches current inventory, obtaining the new version token
    let (status, fresh_list) = admin.request(&state, "GET", "/vms", None).await;
    assert_eq!(status, StatusCode::OK);
    let fresh_version = fresh_list["version"].as_str().expect("fresh version token").to_owned();
    assert_ne!(fresh_version, initial_version);

    // Fresh confirmation with new request_id and fresh version succeeds
    let fresh_request_id = Uuid::new_v4();
    let fresh_payload = json!({
        "ids": ids,
        "request_id": fresh_request_id,
        "version": fresh_version,
    });
    assert_eq!(admin.request(&state, "POST", "/vms/bulk-delete", Some(fresh_payload)).await.0, StatusCode::NO_CONTENT);

    // Target VMs are now deleted
    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM vms WHERE id = ANY($1)")
        .bind(&ids[..]).fetch_one(&state.pool).await.unwrap();
    assert_eq!(remaining, 0, "Fresh confirmation deletes target VMs");
}

#[tokio::test]
#[ignore = "requires Podman; creates and removes its own PostgreSQL 17 container"]
async fn vm_deletion_legacy_call_without_request_id_retains_compatibility() {
    let (_database, state) = Database::start().await;
    let mut admin = Browser::default();
    assert_eq!(admin.request(&state, "POST", "/auth/setup", Some(json!({
        "email":"admin@example.com", "password":"admin-password",
    }))).await.0, StatusCode::CREATED);
    let target = deletion_test_vm(&mut admin, &state, "legacy").await;
    let payload = json!({"ids": [target]});
    assert_eq!(admin.request(&state, "POST", "/vms/bulk-delete", Some(payload)).await.0, StatusCode::NO_CONTENT);
    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM vms WHERE id = $1")
        .bind(target).fetch_one(&state.pool).await.unwrap();
    assert_eq!(remaining, 0);
}

#[tokio::test]
#[ignore = "requires Podman; creates and removes its own PostgreSQL 17 container"]
async fn duplicate_ip_alerts_only_include_running_vms_with_exact_addresses() {
    let (_database, state) = Database::start().await;
    let mut admin = Browser::default();
    assert_eq!(admin.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await.0, StatusCode::CREATED);
    let mut ids = Vec::new();
    for (name, status, ip, role, copies, tags) in [
        ("running-short", "running", "10.0.21.11", "private", 2, vec![]),
        ("running-long", "running", "10.0.21.111", "private", 1, vec![]),
        ("shutdown", "powered_off", "10.0.21.11", "private", 1, vec![]),
        ("different-role", "running", "10.0.21.11", "public", 1, vec![]),
        ("template", "running", "10.0.21.11", "private", 1, vec!["TeMpLaTe"]),
        ("backup", "running", "10.0.21.11", "private", 1, vec!["BaCkUp"]),
    ] {
        let (status_code, vm) = admin.request(&state, "POST", "/vms", Some(json!({
            "name":name,"platform":"vmware","cluster":"test","status":status,
            "criticality":"medium","cpu_cores":1,"memory_mb":1024,
            "networks":vec![json!({"ip_address":ip,"role":role}); copies],
            "tags":tags,
        }))).await;
        assert_eq!(status_code, StatusCode::CREATED, "{vm}");
        ids.push(vm["id"].as_str().unwrap().to_owned());
    }
    for (path, field) in [
        ("/dashboard", Some("duplicate_ip")),
        ("/vms?duplicate_ip=true", Some("items")),
        ("/notifications/duplicate-ips", None),
    ] {
        let (status, body) = admin.request(&state, "GET", path, None).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let alerts = field.map_or(&body, |field| &body[field]);
        assert_eq!(alerts, &json!([]), "{path} must require another eligible VM with the same IP and role");
    }
    let (status, body) = admin.request(&state, "PATCH", &format!("/vms/{}", ids[1]), Some(json!({"networks":[{"ip_address":"10.0.21.11","role":"private"}]}))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    for (path, field) in [("/dashboard", "duplicate_ip"), ("/vms?duplicate_ip=true", "items")] {
        let (status, body) = admin.request(&state, "GET", path, None).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let mut actual: Vec<_> = body[field].as_array().unwrap().iter().map(|vm| vm["id"].as_str().unwrap()).collect();
        actual.sort_unstable();
        let mut expected = vec![ids[0].as_str(), ids[1].as_str()];
        expected.sort_unstable();
        assert_eq!(actual, expected, "{path} must only flag the two running VMs");
        if path == "/dashboard" {
            assert!(body[field].as_array().unwrap().iter().all(|vm| vm["detail"] == "10.0.21.11"));
        }
    }
    let (status, body) = admin.request(&state, "GET", "/vms?duplicate_ip=false", None).await;
    assert_eq!(status, StatusCode::OK);
    let mut non_duplicates: Vec<_> = body["items"].as_array().unwrap().iter()
        .map(|vm| vm["id"].as_str().unwrap()).collect();
    non_duplicates.sort_unstable();
    let mut expected = [ids[2].as_str(), ids[3].as_str()];
    expected.sort_unstable();
    assert_eq!(non_duplicates, expected);
    let (status, body) = admin.request(&state, "GET", "/notifications/duplicate-ips", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!([{
        "ip_address":"10.0.21.11", "occurrences":2,
        "vms":[{"vm_id":ids[1],"name":"running-long"}, {"vm_id":ids[0],"name":"running-short"}],
    }]));

    let (status, body) = admin.request(&state, "PATCH", &format!("/vms/{}", ids[0]), Some(json!({
        "networks":[{"ip_address":"10.0.21.11","role":"private"}, {"ip_address":"10.0.21.11","role":"public"}],
    }))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = admin.request(&state, "GET", "/notifications/duplicate-ips", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!([{
        "ip_address":"10.0.21.11", "occurrences":3,
        "vms":[{"vm_id":ids[3],"name":"different-role"}, {"vm_id":ids[1],"name":"running-long"},
               {"vm_id":ids[0],"name":"running-short"}],
    }]));
}
// Minimal external LDAP adapter: exercise ldap3's real search and password binds.
struct Directory {
    task: tokio::task::JoinHandle<()>,
    uri: String,
    base_dn: String,
    password_binds: Arc<Mutex<HashMap<String, usize>>>,
}
impl Directory {
    async fn start(email: &str) -> Self {
        Self::with_users(&[email]).await
    }
    async fn with_users(emails: &[&str]) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let uri = format!("ldap://{}", listener.local_addr().unwrap());
        let base_dn = format!("dc=fixture{},dc=example", Uuid::new_v4().simple());
        let entries: Vec<_> = emails.iter().map(|email| {
            let uid = email.split('@').next().unwrap().to_owned();
            (format!("uid={uid},{base_dn}"), uid, (*email).to_owned())
        }).collect();
        let password_binds = Arc::new(Mutex::new(HashMap::new()));
        let observed_binds = password_binds.clone();
        let task = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let entries = entries.clone();
                let password_binds = observed_binds.clone();
                tokio::spawn(async move {
                    loop {
                        let Ok(tag) = socket.read_u8().await else { return };
                        assert_eq!(tag, 0x30);
                        let first = socket.read_u8().await.unwrap();
                        let mut length = usize::from(first);
                        if first & 0x80 != 0 {
                            length = 0;
                            for _ in 0..first & 0x7f { length = (length << 8) | usize::from(socket.read_u8().await.unwrap()); }
                        }
                        let mut message = vec![0; length];
                        socket.read_exact(&mut message).await.unwrap();
                        let (id, rest) = field(&message);
                        let operation = rest[0];
                        let (body, _) = field(rest);
                        let result = |code| [ber(0x0a, &[code]), ber(0x04, b""), ber(0x04, b"")].concat();
                        let packet = |op, value: &[u8]| ber(0x30, &[ber(0x02, id), ber(op, value)].concat());
                        match operation {
                            0x60 => {
                                let (_, rest) = field(body);
                                let (dn, rest) = field(rest);
                                let (password, _) = field(rest);
                                if !dn.is_empty() {
                                    *password_binds.lock().entry(String::from_utf8(dn.to_vec()).unwrap()).or_default() += 1;
                                }
                                let code = if password.is_empty() || password == b"directory-password" { 0 } else { 49 };
                                socket.write_all(&packet(0x61, &result(code))).await.unwrap();
                            }
                            0x63 => {
                                let mut rest = body;
                                for _ in 0..6 { rest = field(rest).1; }
                                for (dn, uid, email) in &entries {
                                    if !directory_filter_matches(rest, uid, email) { continue; }
                                    let mail = ber(0x30, &[ber(0x04, b"mail"), ber(0x31, &ber(0x04, email.as_bytes()))].concat());
                                    let entry = [ber(0x04, dn.as_bytes()), ber(0x30, &mail)].concat();
                                    socket.write_all(&packet(0x64, &entry)).await.unwrap();
                                }
                                socket.write_all(&packet(0x65, &result(0))).await.unwrap();
                            }
                            0x42 => return,
                            _ => panic!("Unexpected LDAP operation"),
                        }
                    }
                });
            }
        });
        Self { task, uri, base_dn, password_binds }
    }
    async fn configure(&self, state: &AppState) {
        ldap::save(&state.pool, &state.settings.jwt_secret, json!({"enabled":true,"server_uri":self.uri,"user_base_dn":self.base_dn})).await.unwrap();
    }
    fn binds(&self, uid: &str) -> usize {
        self.password_binds.lock().get(&format!("uid={uid},{}", self.base_dn)).copied().unwrap_or(0)
    }
}
impl Drop for Directory { fn drop(&mut self) { self.task.abort(); } }
fn ber(tag: u8, bytes: &[u8]) -> Vec<u8> {
    let mut result = vec![tag];
    if bytes.len() < 128 { result.push(bytes.len() as u8); }
    else { result.extend([0x82, (bytes.len() >> 8) as u8, bytes.len() as u8]); }
    result.extend_from_slice(bytes);
    result
}
fn field(bytes: &[u8]) -> (&[u8], &[u8]) {
    let mut length = usize::from(bytes[1]);
    let mut offset = 2;
    if bytes[1] & 0x80 != 0 {
        length = 0;
        for _ in 0..bytes[1] & 0x7f { length = (length << 8) | usize::from(bytes[offset]); offset += 1; }
    }
    (&bytes[offset..offset + length], &bytes[offset + length..])
}
fn directory_filter_matches(filter: &[u8], uid: &str, email: &str) -> bool {
    let (body, _) = field(filter);
    match filter[0] {
        0xa3 => {
            let (attribute, value) = field(body);
            let (value, _) = field(value);
            match attribute {
                b"uid" => value == uid.as_bytes(),
                b"mail" => value == email.as_bytes(),
                _ => false,
            }
        }
        0xa1 => {
            let mut rest = body;
            while !rest.is_empty() {
                if directory_filter_matches(rest, uid, email) { return true; }
                rest = field(rest).1;
            }
            false
        }
        _ => panic!("Unsupported fixture LDAP filter tag"),
    }
}

#[tokio::test]
#[ignore = "requires Podman; creates and removes its own PostgreSQL 17 container"]
async fn ldap_credentials_cannot_enter_or_link_a_local_admin() {
    let (_database, state) = Database::start().await;
    let directory = Directory::start("alice@example.com").await;
    directory.configure(&state).await;
    let mut admin = Browser::default();
    assert_eq!(admin.request(&state, "POST", "/auth/setup", Some(json!({"email":"alice@example.com","password":"local-admin-password"}))).await.0, StatusCode::CREATED);
    let mut stranger = Browser::default();
    assert_eq!(stranger.login(&state, "alice@example.com", "directory-password").await, StatusCode::UNAUTHORIZED, "failed local password must not fall back to LDAP");
    assert_eq!(stranger.login(&state, "alice@alias.example", "directory-password").await, StatusCode::UNAUTHORIZED, "directory email collision must not link a local admin");
    assert_eq!(admin.request(&state, "GET", "/auth/me", None).await.1["role"], "admin");
    assert_eq!(stranger.login(&state, "alice@example.com", "local-admin-password").await, StatusCode::OK);
    let directory_only = Directory::start("directory@example.com").await;
    directory_only.configure(&state).await;
    assert_eq!(stranger.login(&state, "directory@example.com", "directory-password").await, StatusCode::OK);
    let (status, user) = stranger.request(&state, "GET", "/auth/me", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(user["auth_source"], "ldap");
    assert_eq!(user["role"], "viewer");
    sqlx::query("UPDATE users SET is_active=false WHERE email=$1")
        .bind("directory@example.com").execute(&state.pool).await.unwrap();
    let binds_before = directory_only.binds("directory");
    assert_eq!(stranger.login(&state, "directory@example.com", "directory-password").await, StatusCode::UNAUTHORIZED);
    assert_eq!(directory_only.binds("directory"), binds_before, "known inactive accounts must not reach LDAP");
    assert_eq!(stranger.login(&state, "directory@alias.example", "directory-password").await, StatusCode::UNAUTHORIZED, "directory aliases must not reactivate inactive accounts");
}

#[tokio::test]
#[ignore = "requires Podman; creates and removes its own PostgreSQL 17 container"]
async fn ldap_alias_domains_share_a_login_budget() {
    let (_database, mut state) = Database::start().await;
    Arc::make_mut(&mut state.settings).app_env = "production".into();
    let directory = Directory::start("alice@example.com").await;
    directory.configure(&state).await;
    let mut browser = Browser::default();
    for i in 0..10 {
        assert_eq!(browser.login(&state, &format!("alice@alias{i}.example"), "wrong-password").await, StatusCode::UNAUTHORIZED);
    }
    assert_eq!(browser.login(&state, "alice@another.example", "wrong-password").await, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
#[ignore = "requires Podman; creates and removes its own PostgreSQL 17 container"]
async fn ldap_custom_or_filter_charges_resolved_dn_before_password_bind() {
    let (_database, mut state) = Database::start().await;
    Arc::make_mut(&mut state.settings).app_env = "production".into();
    let directory = Directory::with_users(&["alice@example.com", "bob@example.com"]).await;
    ldap::save(&state.pool, &state.settings.jwt_secret, json!({
        "enabled":true, "server_uri":directory.uri, "user_base_dn":directory.base_dn,
        "user_filter":"(|(uid={username})(mail={email}))"
    })).await.unwrap();
    let mut browser = Browser::default();
    assert_eq!(browser.request(&state, "POST", "/auth/setup", Some(json!({"email":"alice@local.example","password":"local-password"}))).await.0, StatusCode::CREATED);
    for i in 0..10 {
        assert_eq!(browser.login(&state, &format!("alice@custom{i}.example"), "wrong-password").await, StatusCode::UNAUTHORIZED);
    }
    assert_eq!(directory.binds("alice"), 10);
    assert_eq!(browser.login(&state, "alice@custom-blocked.example", "directory-password").await, StatusCode::TOO_MANY_REQUESTS, "changing both rendered OR filter and submitted email must not reset the resolved account budget");
    assert_eq!(directory.binds("alice"), 10, "rate rejection must happen before any eleventh password bind");
    assert_eq!(browser.login(&state, "alice@local.example", "local-password").await, StatusCode::OK, "an exhausted LDAP DN budget must not consume a local account budget");
    assert_eq!(browser.login(&state, "bob@custom-first.example", "directory-password").await, StatusCode::OK, "a different DN must retain its own budget");
    for i in 1..10 {
        assert_eq!(browser.login(&state, &format!("bob@custom{i}.example"), "wrong-password").await, StatusCode::UNAUTHORIZED);
    }
    assert_eq!(browser.login(&state, "bob@custom-blocked.example", "directory-password").await, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(directory.binds("bob"), 10);
}

#[tokio::test]
#[ignore = "requires Podman; creates and removes its own PostgreSQL 17 container"]
async fn logout_revokes_both_tokens_only_for_the_logged_out_user() {
    let (_database, state) = Database::start().await;
    let mut admin = Browser::default();
    assert_eq!(admin.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await.0, StatusCode::CREATED);
    assert_eq!(admin.request(&state, "POST", "/users", Some(json!({"email":"alice@example.com","password":"original-password","role":"viewer"}))).await.0, StatusCode::CREATED);
    let mut alice = Browser::default();
    assert_eq!(alice.login(&state, "alice@example.com", "original-password").await, StatusCode::OK);
    let mut stolen_session = alice.clone();
    let mut stolen_refresh = alice.clone();
    assert_eq!(alice.request(&state, "POST", "/auth/logout", None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(stolen_session.request(&state, "GET", "/auth/me", None).await.0, StatusCode::UNAUTHORIZED, "old access token survived logout");
    assert_eq!(stolen_refresh.request(&state, "POST", "/auth/refresh", None).await.0, StatusCode::UNAUTHORIZED, "old refresh token survived logout");
    assert_eq!(admin.request(&state, "GET", "/auth/me", None).await.0, StatusCode::OK);
    assert_eq!(admin.request(&state, "POST", "/auth/refresh", None).await.0, StatusCode::OK);
    assert_eq!(alice.login(&state, "alice@example.com", "original-password").await, StatusCode::OK);
    assert_eq!(alice.request(&state, "GET", "/auth/me", None).await.0, StatusCode::OK);
    assert_eq!(alice.request(&state, "POST", "/auth/refresh", None).await.0, StatusCode::OK);
}

#[tokio::test]
#[ignore = "requires Podman; creates and removes its own PostgreSQL 17 container"]
async fn generationless_legacy_tokens_do_not_survive_logout() {
    let (_database, state) = Database::start().await;
    let mut admin = Browser::default();
    assert_eq!(admin.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await.0, StatusCode::CREATED);
    assert_eq!(admin.request(&state, "POST", "/users", Some(json!({"email":"alice@example.com","password":"original-password","role":"viewer"}))).await.0, StatusCode::CREATED);
    let mut alice = Browser::default();
    assert_eq!(alice.login(&state, "alice@example.com", "original-password").await, StatusCode::OK);
    let (id, hash): (uuid::Uuid, String) = sqlx::query_as("SELECT id,password_hash FROM users WHERE email='alice@example.com'").fetch_one(&state.pool).await.unwrap();
    let secret = &state.settings.jwt_secret;
    let credential = crate::core::security::credential_fingerprint(&id.to_string(), "local", &hash, secret);
    let key = jsonwebtoken::EncodingKey::from_secret(secret.as_bytes());
    let now = chrono::Utc::now().timestamp();
    let session = jsonwebtoken::encode(&jsonwebtoken::Header::default(), &crate::core::security::SessionClaims { sub: id.to_string(), role: "viewer".into(), exp: now + 600, iat: now, generation: None, credential: credential.clone() }, &key).unwrap();
    let refresh = jsonwebtoken::encode(&jsonwebtoken::Header::default(), &crate::core::security::RefreshClaims { sub: id.to_string(), r#type: "refresh".into(), persist: true, exp: now + 600, iat: now, generation: None, credential }, &key).unwrap();
    let mut legacy = Browser { cookie: format!("{}={session}; inventorymgr_refresh={refresh}", state.settings.session_cookie_name), csrf: String::new() };
    assert_eq!(legacy.request(&state, "GET", "/auth/me", None).await.0, StatusCode::OK, "legacy session still accepted before logout");
    assert_eq!(legacy.request(&state, "POST", "/auth/refresh", None).await.0, StatusCode::UNAUTHORIZED, "generationless refresh must be rejected");
    assert_eq!(alice.request(&state, "POST", "/auth/logout", None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(legacy.request(&state, "GET", "/auth/me", None).await.0, StatusCode::UNAUTHORIZED, "legacy session survived logout");
}

#[tokio::test]
#[ignore = "requires Podman; creates and removes its own PostgreSQL 17 container"]
async fn password_reset_revokes_both_tokens_only_for_the_reset_user() {
    let (_database, state) = Database::start().await;
    let mut admin = Browser::default();
    assert_eq!(admin.request(&state, "POST", "/auth/setup", Some(json!({"email":"admin@example.com","password":"admin-password"}))).await.0, StatusCode::CREATED);
    let (status, user) = admin.request(&state, "POST", "/users", Some(json!({"email":"alice@example.com","password":"original-password","role":"viewer"}))).await;
    assert_eq!(status, StatusCode::CREATED);
    let mut alice = Browser::default();
    assert_eq!(alice.login(&state, "alice@example.com", "original-password").await, StatusCode::OK);
    let mut stolen = alice.clone();
    assert_eq!(admin.request(&state, "PATCH", &format!("/users/{}", user["id"].as_str().unwrap()), Some(json!({"password":"replacement-password"}))).await.0, StatusCode::OK);
    assert_eq!(alice.request(&state, "GET", "/auth/me", None).await.0, StatusCode::UNAUTHORIZED, "old access token survived password reset");
    assert_eq!(stolen.request(&state, "POST", "/auth/refresh", None).await.0, StatusCode::UNAUTHORIZED, "old refresh token survived password reset");
    assert_eq!(admin.request(&state, "GET", "/auth/me", None).await.0, StatusCode::OK);
    assert_eq!(admin.request(&state, "POST", "/auth/refresh", None).await.0, StatusCode::OK);
    assert_eq!(alice.login(&state, "alice@example.com", "original-password").await, StatusCode::UNAUTHORIZED);
    assert_eq!(alice.login(&state, "alice@example.com", "replacement-password").await, StatusCode::OK);
    assert_eq!(alice.request(&state, "GET", "/auth/me", None).await.0, StatusCode::OK);
    assert_eq!(alice.request(&state, "POST", "/auth/refresh", None).await.0, StatusCode::OK);
}

#[tokio::test]
async fn login_and_setup_reject_oversized_string_fields_before_database_work() {
    let state = AppState {
        pool: sqlx::postgres::PgPoolOptions::new().acquire_timeout(Duration::from_millis(50)).connect_lazy("postgresql://127.0.0.1:1/unused").unwrap(),
        settings: Arc::new(Settings {
            app_env: "test".into(), database_url: String::new(), jwt_secret: "fixture-only".into(),
            session_cookie_name: "session".into(), csrf_cookie_name: "csrf".into(), secure_cookies: false,
            cors_origins: Vec::new(), backup_dir: String::new(), pg_bin_dir: String::new(), host: "127.0.0.1".into(), port: 0,
        }),
        database_access: Arc::new(tokio::sync::RwLock::new(())),
    };
    for path in ["/auth/login", "/auth/setup"] {
        for payload in [
            json!({"email":format!("{}@example.com", "a".repeat(255)),"password":"valid-password"}),
            json!({"email":"alice@example.com","password":"x".repeat(1025)}),
        ] {
            assert_eq!(Browser::default().request(&state, "POST", path, Some(payload)).await.0, StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
}

#[test]
fn maximum_auth_field_lengths_remain_accepted() {
    use crate::api::deps::{validate_fields, JsonSchema};
    for fields in [LoginRequest::FIELDS, SetupAdminRequest::FIELDS] {
        let mut payload = json!({"email":format!("{}@example.com", "a".repeat(242)),"password":"x".repeat(1024)});
        assert!(validate_fields(&mut payload, fields, &[], &[json!("body")]).is_empty());
    }
}
