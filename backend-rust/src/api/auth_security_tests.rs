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
        let app = router().merge(crate::api::accounts::router()).with_state(state.clone());
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
        ldap::save(state, json!({"enabled":true,"server_uri":self.uri,"user_base_dn":self.base_dn})).await.unwrap();
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
    ldap::save(&state, json!({
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
