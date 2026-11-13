use crate::common::{self, Container, Process, Result, Scratch};
use crate::http::http_client::{Client, Upload, PASSWORD};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::Sha256;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

macro_rules! check {
    ($condition:expr, $($message:tt)+) => {
        if !$condition { return Err(format!($($message)+).into()); }
    };
}

type Response = (u16, Value, Vec<u8>);

fn wait_until(mut predicate: impl FnMut() -> Result<bool>, message: &str, seconds: u64) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while !predicate()? {
        check!(Instant::now() < deadline, "{message}");
        thread::sleep(Duration::from_millis(20));
    }
    Ok(())
}

fn clone_client(client: &Client, port: u16) -> Result<Client> {
    let mut result = Client::new(port)?;
    result.set_cookies(client.cookies().clone())?;
    Ok(result)
}

fn field<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value[key].as_str().ok_or_else(|| format!("Missing string {key}: {value}").into())
}

fn named_vm(vm: &Value, name: &str) -> Value {
    let mut payload = vm.clone();
    payload["name"] = json!(name);
    payload
}

fn token_claims(token: &str) -> Result<Value> {
    let payload = token.split('.').nth(1).ok_or("Invalid JWT")?;
    Ok(serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload.trim_end_matches('='))?)?)
}

fn signed_token(claims: &Value, secret: &str) -> Result<String> {
    let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
    let payload = format!("{header}.{}", URL_SAFE_NO_PAD.encode(serde_json::to_vec(claims)?));
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())?;
    mac.update(payload.as_bytes());
    Ok(format!("{payload}.{}", URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())))
}

fn request(client: &mut Client, method: &str, path: &str, payload: Option<Value>) -> Result<Response> {
    client.request(method, path, payload, true, None, None)
}

fn restore(client: &mut Client, filename: &str, content: &[u8]) -> Result<Response> {
    client.request("POST", "/api/backups/restore", None, true, Some(Upload {
        filename, content, mime: "application/octet-stream", fields: &[("confirm", "RESTORE")],
    }), None)
}

fn download(client: &mut Client, filename: &str) -> Result<Vec<u8>> {
    Ok(request(client, "GET", &format!("/api/backups/{filename}/download"), None)?.2)
}

fn socket(port: u16, seconds: u64) -> Result<TcpStream> {
    let stream = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(seconds))?;
    stream.set_read_timeout(Some(Duration::from_secs(seconds)))?;
    stream.set_write_timeout(Some(Duration::from_secs(seconds)))?;
    Ok(stream)
}

fn received(stream: &mut TcpStream, expected: &str) -> Result<bool> {
    let mut buffer = [0; 4096];
    let count = stream.read(&mut buffer)?;
    Ok(buffer[..count].windows(expected.len()).any(|part| part == expected.as_bytes()))
}

fn upload_headers(client: &Client, length: usize) -> Result<String> {
    let cookies = client.cookies().iter().map(|(name, value)| format!("{name}={value}")).collect::<Vec<_>>().join("; ");
    let csrf = client.cookies().get("inventorymgr_csrf").ok_or("Missing CSRF cookie")?;
    Ok(format!("POST /api/backups/restore HTTP/1.1\r\nHost: localhost\r\nCookie: {cookies}\r\nX-CSRF-Token: {csrf}\r\nContent-Type: multipart/form-data; boundary=slow\r\nContent-Length: {length}\r\n\r\n"))
}

fn bridge_binary(directory: &Path, binary: &str) -> PathBuf {
    directory.join(format!("{binary}{}", std::env::consts::EXE_SUFFIX))
}

#[allow(clippy::too_many_arguments)] // one flat call per Python wrapper barrier keeps call sites 1:1 with the spec
fn barrier(directory: &Path, binary: &str, phase: &str, entered: &Path, release: &Path, write_output: bool, once: bool, timeout_ms: Option<u64>, scope: &str) -> Result<()> {
    common::write_json(directory.join(format!("{binary}.barrier.json")), &json!({
        "phase": phase, "entered": entered, "release": release, "write_output": write_output,
        "once": once, "timeout_ms": timeout_ms, "scope": scope,
    }))
}

fn clear_barrier(directory: &Path, binary: &str) -> Result<()> {
    fs::remove_file(directory.join(format!("{binary}.barrier.json")))?;
    Ok(())
}

fn readable_archive(directory: &Path, archive: &Path, environment: &HashMap<String, String>) -> Result<()> {
    let status = Command::new(bridge_binary(directory, "pg_restore")).arg("--file=-").arg(archive)
        .envs(environment).stdout(Stdio::null()).status()?;
    check!(status.success(), "pg_restore archive check failed: {status}");
    Ok(())
}

fn spawn_backend(binary: &Path, environment: &HashMap<String, String>, log: &File, port: u16) -> Result<Process> {
    let mut process = Process(Command::new(binary).envs(environment).current_dir(common::root())
        .stdout(log.try_clone()?).stderr(log.try_clone()?).spawn()?);
    common::wait_ready(&mut process.0, port)?;
    Ok(process)
}

struct Pending<T> {
    receiver: Receiver<std::result::Result<T, String>>,
    ready: Option<std::result::Result<T, String>>,
}

impl<T> Pending<T> {
    fn done(&mut self) -> Result<bool> {
        if self.ready.is_some() { return Ok(true); }
        match self.receiver.try_recv() {
            Ok(value) => { self.ready = Some(value); Ok(true) }
            Err(TryRecvError::Empty) => Ok(false),
            Err(TryRecvError::Disconnected) => Err("HTTP worker disconnected".into()),
        }
    }

    fn timed(&mut self, seconds: u64) -> Result<Option<T>> {
        let value = if let Some(value) = self.ready.take() { value } else {
            match self.receiver.recv_timeout(Duration::from_secs(seconds)) {
                Ok(value) => value,
                Err(RecvTimeoutError::Timeout) => return Ok(None),
                Err(RecvTimeoutError::Disconnected) => return Err("HTTP worker disconnected".into()),
            }
        };
        value.map(Some).map_err(Into::into)
    }

    fn result(&mut self, seconds: u64) -> Result<T> {
        self.timed(seconds)?.ok_or_else(|| "HTTP worker timed out".into())
    }
}

#[derive(Default)]
struct Cleanup {
    releases: Vec<PathBuf>,
    locker: Option<Process>,
    process: Option<Process>,
    workers: Vec<JoinHandle<()>>,
}

impl Cleanup {
    fn submit<T: Send + 'static>(&mut self, work: impl FnOnce() -> Result<T> + Send + 'static) -> Pending<T> {
        let (sender, receiver) = mpsc::channel();
        self.workers.push(thread::spawn(move || { let _ = sender.send(work().map_err(|error| error.to_string())); }));
        Pending { receiver, ready: None }
    }

    fn backend(&mut self) -> Result<&mut Process> {
        self.process.as_mut().ok_or_else(|| "Backend process not started".into())
    }
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        for release in &self.releases { let _ = File::create(release); }
        if let Some(mut locker) = self.locker.take() {
            drop(locker.0.stdin.take());
            if locker.wait(Duration::from_secs(10)).is_err() {
                let _ = locker.0.kill();
                let _ = locker.0.wait();
            }
        }
        drop(self.process.take());
        for worker in self.workers.drain(..) { let _ = worker.join(); }
    }
}

fn directory_names(path: &Path) -> Result<Vec<std::ffi::OsString>> {
    let mut names = fs::read_dir(path)?.map(|entry| entry.map(|entry| entry.file_name())).collect::<std::io::Result<Vec<_>>>()?;
    names.sort();
    Ok(names)
}

fn observed(lifecycle: &mut Value, output: &Path, name: &str, passed: bool) -> Result<()> {
    lifecycle[name] = json!(passed);
    common::write_json(output.join("lifecycle.json"), lifecycle)?;
    check!(passed, "{name}");
    Ok(())
}

fn second_instance(binary: &Path, environment: &HashMap<String, String>) -> Result<(bool, String)> {
    let mut child = Process(Command::new(binary).envs(environment).env("PORT", common::free_port()?.to_string())
        .current_dir(common::root()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?);
    let mut stdout = child.0.stdout.take().ok_or("Missing second instance stdout")?;
    let mut stderr = child.0.stderr.take().ok_or("Missing second instance stderr")?;
    let out = thread::spawn(move || { let mut bytes = Vec::new(); stdout.read_to_end(&mut bytes).map(|_| bytes) });
    let err = thread::spawn(move || { let mut bytes = Vec::new(); stderr.read_to_end(&mut bytes).map(|_| bytes) });
    let status = child.wait(Duration::from_secs(20));
    if status.is_err() { let _ = child.0.kill(); let _ = child.0.wait(); }
    let mut bytes = out.join().map_err(|_| "Second instance stdout reader panicked")??;
    bytes.extend(err.join().map_err(|_| "Second instance stderr reader panicked")??);
    Ok((status?.success(), String::from_utf8_lossy(&bytes).into_owned()))
}

pub fn run(binary: &Path, output: &Path) -> Result<()> {
    fs::create_dir_all(output)?;
    let binary = binary.canonicalize()?;
    let scratch_guard = Scratch::new(&std::env::temp_dir(), "inventorymgr-restore-")?;
    let scratch = &scratch_guard.0;
    let release = scratch.join("restore-release");
    let mut container = Container { name: format!("inventorymgr-rust-parity-{}", common::token(6)), port: 0 };
    let mut cleanup = Cleanup::default();
    cleanup.releases.push(release.clone());
    let mut results = json!({});
    common::command(&["podman", "run", "--detach", "--name", &container.name, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "docker.io/library/postgres:17-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27"])?;
    container.port = common::command(&["podman", "port", &container.name, "5432/tcp"])?.rsplit(':').next().ok_or("Missing PostgreSQL port")?.parse()?;
    wait_until(|| Ok(Command::new("podman").args(["exec", &container.name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"])
        .stdout(Stdio::null()).stderr(Stdio::null()).status()?.success()), "PostgreSQL readiness timed out", 30)?;
    container.create_db("parity_restore")?;
    let sql = |text: &str| container.sql("parity_restore", text);
    let pg_bin = scratch.join("pg-bin");
    common::install_bridge(&pg_bin)?;
    let restore_entered = scratch.join("restore-entered");
    barrier(&pg_bin, "pg_restore", "before", &restore_entered, &release, false, false, Some(30_000), "live")?;
    let http_port = common::free_port()?;
    let environment = HashMap::from([
        ("APP_ENV".into(), "test".into()),
        ("DATABASE_URL".into(), container.url("parity_restore")),
        ("JWT_SECRET".into(), common::token(32)),
        ("HOST".into(), "127.0.0.1".into()),
        ("PORT".into(), http_port.to_string()),
        ("BACKUP_DIR".into(), scratch.join("backups").to_string_lossy().into_owned()),
        ("PG_BIN_DIR".into(), pg_bin.to_string_lossy().into_owned()),
        ("PARITY_PG_CONTAINER".into(), container.name.clone()),
        ("PARITY_PG_URL".into(), "postgresql://postgres@127.0.0.1:5432/parity_restore".into()),
        ("PARITY_RESTORE_ENTERED".into(), restore_entered.to_string_lossy().into_owned()),
        ("PARITY_RESTORE_RELEASE".into(), release.to_string_lossy().into_owned()),
    ]);
    let log = File::create(output.join("backend.log"))?;
    cleanup.process = Some(spawn_backend(&binary, &environment, &log, http_port)?);
    let mut admin = Client::new(http_port)?;
    admin.must("POST", "/api/auth/setup", Some(json!({"email": "admin@parity.test", "password": PASSWORD})))?;
    {
        let mut slow_login = socket(http_port, 2)?;
        let mut anonymous_restore = socket(http_port, 2)?;
        slow_login.write_all(b"POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{")?;
        thread::sleep(Duration::from_millis(100));
        anonymous_restore.write_all(b"POST /api/backups/restore HTTP/1.1\r\nHost: localhost\r\nContent-Type: multipart/form-data; boundary=slow\r\nContent-Length: 100\r\n\r\n")?;
        thread::sleep(Duration::from_millis(100));
        {
            let mut probe = socket(http_port, 2)?;
            probe.write_all(b"GET /api/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")?;
            check!(received(&mut probe, "200 OK")?, "Slow anonymous bodies blocked health");
        }
        admin.must("GET", "/api/auth/me", None)?;
        check!(received(&mut anonymous_restore, "401 Unauthorized")?, "Anonymous restore waited for its body");
    }
    results["slow_anonymous_bodies_do_not_block_health"] = json!(true);
    let oversized_status = request(&mut Client::new(http_port)?, "POST", "/api/auth/login", Some(json!({"email": "x".repeat(2 * 1024 * 1024), "password": PASSWORD})))?.0;
    check!(oversized_status == 413, "Oversized anonymous body was not rejected before parsing: {oversized_status}");
    results["ordinary_body_limit_413"] = json!(true);
    let vm = json!({"platform": "proxmox", "cluster": "restore-parity", "status": "running", "cpu_cores": 1, "memory_mb": 1024, "criticality": "low"});
    let sentinel = admin.must("POST", "/api/vms", Some(named_vm(&vm, "snapshot-sentinel")))?;
    let backup = admin.must("POST", "/api/backups", None)?;
    let archive = download(&mut admin, field(&backup, "filename")?)?;
    {
        let mut slow_restore = socket(http_port, 5)?;
        slow_restore.write_all(upload_headers(&admin, 100)?.as_bytes())?;
        thread::sleep(Duration::from_millis(200));
        admin.must("GET", "/api/auth/me", None)?;
        let during_upload = admin.must("POST", "/api/vms", Some(named_vm(&vm, "write-during-upload")))?;
        admin.must("DELETE", &format!("/api/vms/{}", field(&during_upload, "id")?), None)?;
    }
    results["authenticated_slow_upload_does_not_hold_gate"] = json!(true);
    let uploader_user = admin.must("POST", "/api/users", Some(json!({"email": "upload-admin@parity.test", "password": PASSWORD, "role": "admin"})))?;
    let mut uploader = Client::new(http_port)?;
    uploader.must("POST", "/api/auth/login", Some(json!({"email": "upload-admin@parity.test", "password": PASSWORD})))?;
    let mut upload_body = b"--slow\r\nContent-Disposition: form-data; name=\"confirm\"\r\n\r\nRESTORE\r\n--slow\r\nContent-Disposition: form-data; name=\"file\"; filename=\"parity.dump\"\r\nContent-Type: application/octet-stream\r\n\r\n".to_vec();
    upload_body.extend_from_slice(&archive);
    upload_body.extend_from_slice(b"\r\n--slow--\r\n");
    let before_revoked_restore = sql("SELECT count(*) FROM backup_jobs")?;
    {
        let mut slow_restore = socket(http_port, 20)?;
        let mut headers = upload_headers(&uploader, upload_body.len())?.into_bytes();
        headers.extend_from_slice(&upload_body[..200]);
        slow_restore.write_all(&headers)?;
        thread::sleep(Duration::from_millis(200));
        admin.must("GET", "/api/auth/me", None)?;
        sql(&format!("UPDATE users SET role='viewer' WHERE id='{}'", field(&uploader_user, "id")?))?;
        slow_restore.write_all(&upload_body[200..])?;
        check!(received(&mut slow_restore, "403 Forbidden")?, "Restore did not revalidate admin role after upload");
    }
    check!(sql("SELECT count(*) FROM backup_jobs")? == before_revoked_restore, "Revoked uploader created a recovery backup");
    wait_until(|| Ok(sql("SELECT count(*) FROM pg_database WHERE datname LIKE 'im_restore_%' OR datname LIKE 'inventorymgr_restore_%'")? == "0"), "Staging database leaked after revoked upload", 30)?;
    results["restore_admin_revalidated_after_upload"] = json!(true);
    let before_jobs = sql("SELECT count(*) FROM backup_jobs")?;
    let (invalid_status, invalid_body, _) = restore(&mut admin, "invalid.dump", b"PGDMPinvalid")?;
    check!(invalid_status == 400, "Invalid custom archive reported success: {invalid_status} {invalid_body}");
    check!(sql("SELECT count(*) FROM backup_jobs")? == before_jobs, "Invalid archive created a recovery backup or restore job");
    check!(sql("SELECT count(*) FROM vms WHERE name='snapshot-sentinel'")? == "1", "Invalid archive changed the database");
    admin.must("GET", "/api/auth/me", None)?;
    results["invalid_archive_rejected_without_changes"] = json!(true);

    let mut first = clone_client(&admin, http_port)?;
    let mut second = clone_client(&admin, http_port)?;
    let mut first = cleanup.submit(move || first.must("POST", "/api/backups", None));
    let mut second = cleanup.submit(move || second.must("POST", "/api/backups", None));
    let concurrent = [first.result(45)?, second.result(45)?];
    let names = [field(&concurrent[0], "filename")?, field(&concurrent[1], "filename")?];
    check!(names[0] != names[1], "Concurrent backups collided: {names:?}");
    for name in names {
        let content = download(&mut admin, name)?;
        let candidate = scratch.join(name);
        fs::write(&candidate, content)?;
        readable_archive(&pg_bin, &candidate, &environment)?;
        admin.must("DELETE", &format!("/api/backups/{name}"), None)?;
    }
    results["concurrent_manual_archives_distinct_and_readable"] = json!(true);

    admin.must("PATCH", "/api/backups/settings", Some(json!({"retention": 1})))?;
    let dump_entered = scratch.join("dump-entered");
    let dump_release = scratch.join("dump-release");
    cleanup.releases.push(dump_release.clone());
    barrier(&pg_bin, "pg_dump", "after", &dump_entered, &dump_release, true, true, Some(30_000), "all")?;
    let mut client = clone_client(&admin, http_port)?;
    let mut pending = cleanup.submit(move || client.must("POST", "/api/backups", None));
    let retention = (|| -> Result<()> {
        wait_until(|| Ok(dump_entered.exists()), "Manual dump did not reach barrier", 30)?;
        admin.must("POST", "/api/backups", None)?;
        check!(Path::new(&fs::read_to_string(&dump_entered)?).is_file(), "Retention removed an in-progress backup");
        Ok(())
    })();
    File::create(&dump_release)?;
    retention?;
    pending.result(30)?;
    clear_barrier(&pg_bin, "pg_dump")?;
    admin.must("PATCH", "/api/backups/settings", Some(json!({"retention": 7})))?;
    results["retention_preserves_inflight_manual_backup"] = json!(true);

    sql("CREATE FUNCTION parity_fail_restore() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_TAG='CREATE TABLE' THEN RAISE EXCEPTION 'parity forced restore failure'; END IF; END $$; CREATE EVENT TRIGGER parity_fail_restore ON ddl_command_start EXECUTE FUNCTION parity_fail_restore()")?;
    let mut stale = clone_client(&admin, http_port)?;
    File::create(&release)?;
    let (failed_status, failed_body, _) = restore(&mut admin, "parity.dump", &archive)?;
    check!(failed_status == 500, "Failed pg_restore reported success: {failed_status} {failed_body}");
    check!(sql("SELECT count(*) FROM vms WHERE name='snapshot-sentinel'")? == "1", "Failed transactional restore destroyed existing rows");
    check!(sql("SELECT status FROM backup_jobs WHERE kind='restore' ORDER BY started_at DESC LIMIT 1")? == "failed", "Failed restore job was not marked failed");
    check!(request(&mut stale, "GET", "/api/auth/me", None)?.0 == 401, "Failed restore left the old session valid");
    check!(request(&mut stale, "POST", "/api/auth/refresh", None)?.0 == 401, "Failed restore left the old refresh valid");
    sql("DROP EVENT TRIGGER parity_fail_restore; DROP FUNCTION parity_fail_restore()")?;
    fs::remove_file(&release)?;
    fs::remove_file(&restore_entered)?;
    admin.must("POST", "/api/auth/login", Some(json!({"email": "admin@parity.test", "password": PASSWORD})))?;
    let auth_guard = scratch.join("backups/.restore-auth-blocked");
    check!(!auth_guard.exists(), "Recovered failed restore left auth blocked");
    results["failed_restore_rolls_back_and_revokes_sessions"] = json!(true);

    let restoring_admin = admin.must("POST", "/api/users", Some(json!({"email": "later-admin@parity.test", "password": PASSWORD, "role": "admin"})))?;
    let mut requester = Client::new(http_port)?;
    requester.must("POST", "/api/auth/login", Some(json!({"email": "later-admin@parity.test", "password": PASSWORD})))?;
    let mut writer = clone_client(&admin, http_port)?;
    let before_restore = clone_client(&admin, http_port)?;
    let _claims = token_claims(admin.cookies().get("inventorymgr_session").ok_or("Missing session cookie")?)?;
    sql("CREATE FUNCTION parity_block_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(7115123); RETURN NEW; END $$; CREATE TRIGGER parity_block_write BEFORE UPDATE ON vms FOR EACH ROW EXECUTE FUNCTION parity_block_write()")?;
    cleanup.locker = Some(Process(Command::new("podman").args(["exec", "-i", &container.name, "psql", "-U", "postgres", "-d", "parity_restore", "-At", "-v", "ON_ERROR_STOP=1"])
        .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn()?));
    let locker_stdin = cleanup.locker.as_mut().ok_or("Missing query blocker")?.0.stdin.as_mut().ok_or("Missing query blocker stdin")?;
    locker_stdin.write_all(b"SELECT pg_advisory_lock(7115123);\n")?;
    locker_stdin.flush()?;
    wait_until(|| Ok(sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=7115123 AND granted")? == "1"), "Query blocker did not acquire its lock", 30)?;
    let sentinel_path = format!("/api/vms/{}", field(&sentinel, "id")?);
    let mut inflight = cleanup.submit(move || {
        let response = request(&mut writer, "PATCH", &sentinel_path, Some(json!({"owner": "accepted-before-restore"})))?;
        Ok((response, writer))
    });
    wait_until(|| Ok(sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=7115123 AND NOT granted")? == "1"), "In-flight HTTP write did not reach PostgreSQL", 30)?;
    let restore_archive = archive.clone();
    let mut restoring = cleanup.submit(move || restore(&mut requester, "parity.dump", &restore_archive));
    results["restore_waited_for_inflight"] = json!(wait_until(|| Ok(restore_entered.exists()), "Restore is waiting for the in-flight query", 1).is_err());
    let locker = cleanup.locker.as_mut().ok_or("Missing query blocker")?;
    drop(locker.0.stdin.take());
    locker.wait(Duration::from_secs(10))?;
    let ((inflight_status, inflight_body, _), mut writer) = inflight.result(45)?;
    check!(inflight_status == 200, "In-flight write failed: {inflight_status} {inflight_body}");
    wait_until(|| Ok(restore_entered.exists() || restoring.done()?), "Restore never reached real pg_restore", 30)?;
    if restoring.done()? { return Err(format!("Restore returned before pg_restore barrier: {:?}", restoring.result(45)?).into()); }
    let concurrent_vm = named_vm(&vm, "concurrent-write");
    let mut write = cleanup.submit(move || request(&mut writer, "POST", "/api/vms", Some(concurrent_vm)));
    let early_write = write.timed(1)?;
    results["write_during_restore"] = match &early_write {
        Some((status, body, _)) => json!({"status": status, "body": body}),
        None => json!("blocked"),
    };
    File::create(&release)?;
    let (restore_status, restore_body, _) = restoring.result(45)?;
    let (write_status, write_body, _) = match early_write { Some(response) => response, None => write.result(45)? };
    check!(restore_status == 200, "Restore failed: {restore_status} {restore_body}");
    check!(restore_body["status"] == "success" && restore_body.get("user_id") == Some(&Value::Null), "Restore failed to tolerate missing actor: {restore_body}");
    check!(sql(&format!("SELECT count(*) FROM users WHERE id='{}'", field(&restoring_admin, "id")?))? == "0", "Restore did not remove the post-snapshot actor");
    check!(!auth_guard.exists(), "Successful restore left auth blocked");
    results["missing_restore_actor_logged_as_null"] = json!(true);
    let epoch: i64 = sql("SELECT value FROM app_settings WHERE key='session_epoch'")?.parse()?;
    let mut same_second = clone_client(&before_restore, http_port)?;
    let mut cookies = same_second.cookies().clone();
    for (name, cookie) in &mut cookies {
        if name == "inventorymgr_session" || name == "inventorymgr_refresh" {
            let mut claims = token_claims(cookie)?;
            claims["iat"] = json!(epoch);
            *cookie = signed_token(&claims, &environment["JWT_SECRET"])?;
        }
    }
    same_second.set_cookies(cookies)?;
    check!(request(&mut same_second, "GET", "/api/auth/me", None)?.0 == 401, "Same-second pre-restore generation survived");
    check!(request(&mut same_second, "POST", "/api/auth/refresh", None)?.0 == 401, "Same-second pre-restore refresh survived");
    let mut cookies = same_second.cookies().clone();
    for (name, cookie) in &mut cookies {
        if name == "inventorymgr_session" || name == "inventorymgr_refresh" {
            let mut claims = token_claims(cookie)?;
            claims.as_object_mut().ok_or("JWT claims are not an object")?.remove("generation");
            *cookie = signed_token(&claims, &environment["JWT_SECRET"])?;
        }
    }
    same_second.set_cookies(cookies)?;
    check!(request(&mut same_second, "GET", "/api/auth/me", None)?.0 == 401, "Same-second legacy session survived");
    check!(request(&mut same_second, "POST", "/api/auth/refresh", None)?.0 == 401, "Same-second legacy refresh survived");
    results["same_second_session_and_refresh_revoked"] = json!(true);
    let rows = common::command(&["podman", "exec", &container.name, "psql", "-U", "postgres", "-d", "parity_restore", "-At", "-v", "ON_ERROR_STOP=1", "-c", "SELECT count(*) FROM vms WHERE name='concurrent-write'"])?;
    let row_count: i64 = rows.parse()?;
    results["write_response"] = json!(write_status);
    results["persisted_concurrent_rows"] = json!(row_count);
    results["restore_status"] = json!(restore_status);
    common::write_json(output.join("results.json"), &results)?;
    check!(write_status != 201 || row_count == 1, "Acknowledged concurrent write lost: HTTP {write_status}, restored rows {rows}");
    check!(results["write_during_restore"] == "blocked", "Database write ran during destructive restore: {}", results["write_during_restore"]);
    check!(write_status == 401, "Queued pre-restore session was not revalidated: {write_status} {write_body}");
    check!(results["restore_waited_for_inflight"] == true, "Destructive restore began while an HTTP SQL query was in flight");
    container.create_db("parity_recovery")?;
    let mut recovery = Vec::new();
    for entry in fs::read_dir(scratch.join("backups"))? {
        let path = entry?.path();
        let name = path.file_name().and_then(|name| name.to_str()).ok_or("Invalid backup filename")?;
        if name.contains("-pre_restore-") && name.ends_with(".dump") { recovery.push((path.metadata()?.modified()?, path)); }
    }
    recovery.sort_by_key(|entry| entry.0);
    let recovery = recovery.last().ok_or("No pre-restore recovery archive")?.1.clone();
    let restored = Command::new("podman").args(["exec", "-i", &container.name, "pg_restore", "--no-owner", "--no-privileges", "--dbname=postgresql://postgres@127.0.0.1:5432/parity_recovery"])
        .stdin(File::open(recovery)?).output()?;
    check!(restored.status.success(), "Recovery pg_restore failed: {}", String::from_utf8_lossy(&restored.stderr));
    check!(container.sql("parity_recovery", "SELECT owner FROM vms WHERE name='snapshot-sentinel'")? == "accepted-before-restore", "Pre-restore recovery archive omitted the acknowledged in-flight write");
    results["inflight_write_in_recovery_archive"] = json!("retained");
    admin.must("POST", "/api/auth/login", Some(json!({"email": "admin@parity.test", "password": PASSWORD})))?;
    admin.must("POST", "/api/vms", Some(named_vm(&vm, "accepted-after-restore")))?;
    check!(common::command(&["podman", "exec", &container.name, "psql", "-U", "postgres", "-d", "parity_restore", "-At", "-c", "SELECT count(*) FROM vms WHERE name='accepted-after-restore'"])? == "1", "Fresh write did not persist");
    results["fresh_write_after_restore"] = json!("persisted");
    let mut restart_stale = clone_client(&admin, http_port)?;
    sql("UPDATE alembic_version SET version_num='parity_unknown'")?;
    let incompatible = admin.must("POST", "/api/backups", None)?;
    let incompatible_archive = download(&mut admin, field(&incompatible, "filename")?)?;
    sql("UPDATE alembic_version SET version_num='0024'")?;
    let before_rejection = sql("SELECT json_build_object('vms',(SELECT jsonb_agg(to_jsonb(v)) FROM vms v),'jobs',(SELECT jsonb_agg(to_jsonb(j)) FROM backup_jobs j),'sessions',(SELECT jsonb_agg(to_jsonb(s)) FROM app_settings s WHERE key IN ('session_generation','session_epoch')))")?;
    let files_before_rejection = directory_names(&scratch.join("backups"))?;
    let (recovery_status, recovery_body, _) = restore(&mut admin, "unknown-revision.dump", &incompatible_archive)?;
    check!(recovery_status == 400, "Incompatible archive was not rejected: {recovery_status} {recovery_body}");
    check!(!auth_guard.exists(), "Rejected archive created an auth guard");
    check!(sql("SELECT json_build_object('vms',(SELECT jsonb_agg(to_jsonb(v)) FROM vms v),'jobs',(SELECT jsonb_agg(to_jsonb(j)) FROM backup_jobs j),'sessions',(SELECT jsonb_agg(to_jsonb(s)) FROM app_settings s WHERE key IN ('session_generation','session_epoch')))")? == before_rejection, "Rejected archive changed live rows, backup jobs or session generation");
    check!(directory_names(&scratch.join("backups"))? == files_before_rejection, "Rejected archive created recovery side effects");
    wait_until(|| Ok(sql("SELECT count(*) FROM pg_database WHERE datname LIKE 'im_restore_%' OR datname LIKE 'inventorymgr_restore_%'")? == "0"), "Staging database leaked after rejection", 30)?;
    restart_stale.must("GET", "/api/auth/me", None)?;
    check!(request(&mut restart_stale, "POST", "/api/auth/refresh", None)?.0 == 200, "Rejected archive revoked refresh token");
    results["unknown_revision_rejected_without_live_changes"] = json!(true);
    let status = cleanup.backend()?.stop()?;
    check!(status.success(), "SIGTERM was not graceful: {status}");
    cleanup.process = Some(spawn_backend(&binary, &environment, &log, http_port)?);
    restart_stale.must("GET", "/api/auth/me", None)?;
    results["sigterm_graceful_and_tokens_unchanged"] = json!(true);

    let crash_entered = scratch.join("crash-dump-entered");
    let crash_release = scratch.join("crash-dump-release");
    cleanup.releases.push(crash_release.clone());
    barrier(&pg_bin, "pg_dump", "after", &crash_entered, &crash_release, true, false, None, "all")?;
    let mut client = clone_client(&restart_stale, http_port)?;
    let mut interrupted = cleanup.submit(move || request(&mut client, "POST", "/api/backups", None));
    wait_until(|| Ok(crash_entered.exists()), "Crash fixture dump did not reach barrier", 30)?;
    let partial = PathBuf::from(fs::read_to_string(&crash_entered)?);
    check!(partial.extension().is_some_and(|suffix| suffix == "partial") && partial.is_file(), "Running dump was exposed as final archive");
    let (success, second_output) = second_instance(&binary, &environment)?;
    check!(!success && second_output.contains("Another InventoryMGR instance"), "Second instance did not refuse database ownership");
    check!(partial.exists(), "Second instance reconciled a live backup");
    cleanup.backend()?.0.kill()?;
    cleanup.backend()?.wait(Duration::from_secs(20))?;
    File::create(&crash_release)?;
    let _ = interrupted.result(10);
    clear_barrier(&pg_bin, "pg_dump")?;
    cleanup.process = Some(spawn_backend(&binary, &environment, &log, http_port)?);
    check!(sql("SELECT count(*) FROM backup_jobs WHERE status='running'")? == "0", "Restart left interrupted jobs running");
    check!(sql("SELECT count(*) FROM backup_jobs WHERE status='failed' AND error='Backup interrupted by application shutdown'")? != "0", "Interrupted backup not marked failed");
    check!(!partial.exists() && !partial.with_extension("").exists(), "Interrupted archive remained downloadable");
    restart_stale.must("GET", "/api/auth/me", None)?;
    results["crash_reconciles_partial_backup_with_single_instance_lease"] = json!(true);

    let mut lifecycle = json!({});
    let retained = restart_stale.must("POST", "/api/backups", None)?;
    let retained_bytes = download(&mut restart_stale, field(&retained, "filename")?)?;
    let (status, body, _) = restore(&mut restart_stale, "completed.dump", &retained_bytes)?;
    check!(status == 200, "({status}, {body})");
    check!(sql(&format!("SELECT status FROM backup_jobs WHERE id='{}'", field(&retained, "id")?))? == "running", "Retained backup did not restore running snapshot job");
    cleanup.backend()?.stop()?;
    cleanup.process = Some(spawn_backend(&binary, &environment, &log, http_port)?);
    let retained_path = scratch.join("backups").join(field(&retained, "filename")?);
    let readable = retained_path.exists();
    if readable { readable_archive(&pg_bin, &retained_path, &environment)?; }
    observed(&mut lifecycle, output, "completed_archive_survives_restore_restart", readable)?;
    restart_stale = Client::new(http_port)?;
    restart_stale.must("POST", "/api/auth/login", Some(json!({"email": "admin@parity.test", "password": PASSWORD})))?;

    let live_oid = sql("SELECT oid::bigint FROM pg_database WHERE datname=current_database()")?;
    let prefix = format!("im_restore_{live_oid}_");
    let controls = [format!("{prefix}unrelated"), format!("im_restore_4294967295_{}", common::token(16)), format!("inventorymgr_restore_{}", common::token(16)), format!("{prefix}{}", common::token(16))];
    sql("CREATE ROLE parity_other")?;
    for (index, name) in controls.iter().enumerate() {
        sql(&format!("CREATE DATABASE {name}{}", if index == controls.len() - 1 { " OWNER parity_other" } else { "" }))?;
    }
    let stage_entered = scratch.join("stage-entered");
    let stage_release = scratch.join("stage-release");
    cleanup.releases.push(stage_release.clone());
    barrier(&pg_bin, "pg_restore", "before", &stage_entered, &stage_release, false, false, None, "staging")?;
    let mut client = clone_client(&restart_stale, http_port)?;
    let staging_archive = retained_bytes.clone();
    let mut staging_request = cleanup.submit(move || restore(&mut client, "crash.dump", &staging_archive));
    wait_until(|| Ok(stage_entered.exists()), "Staging did not reach crash barrier", 30)?;
    let orphan = sql(&("SELECT datname FROM pg_database WHERE (datname LIKE 'im_restore_%' OR datname LIKE 'inventorymgr_restore_%') AND datname NOT IN (".to_owned() + &controls.iter().map(|name| format!("'{name}'")).collect::<Vec<_>>().join(",") + ")"))?;
    check!(!orphan.is_empty() && orphan.len() < 63, "Invalid orphan staging database: {orphan}");
    cleanup.backend()?.0.kill()?;
    cleanup.backend()?.wait(Duration::from_secs(20))?;
    File::create(&stage_release)?;
    let _ = staging_request.result(15);
    barrier(&pg_bin, "pg_restore", "before", &restore_entered, &release, false, false, Some(30_000), "live")?;
    cleanup.process = Some(spawn_backend(&binary, &environment, &log, http_port)?);
    observed(&mut lifecycle, output, "crash_orphan_reclaimed", sql(&format!("SELECT count(*) FROM pg_database WHERE datname='{orphan}'"))? == "0")?;
    let mut preserved = true;
    for name in &controls {
        if sql(&format!("SELECT count(*) FROM pg_database WHERE datname='{name}'"))? != "1" { preserved = false; break; }
    }
    observed(&mut lifecycle, output, "unrelated_scope_role_names_preserved", preserved)?;
    for name in &controls { sql(&format!("DROP DATABASE {name} WITH (FORCE)"))?; }

    let lease_pid = sql("SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=1 AND objid=3978674610")?;
    check!(!lease_pid.is_empty() && lease_pid.bytes().all(|byte| byte.is_ascii_digit()), "Dedicated lease session not found");
    sql(&format!("SELECT pg_terminate_backend({lease_pid})"))?;
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut lease_exit = cleanup.backend()?.0.try_wait()?;
    while lease_exit.is_none() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(50));
        lease_exit = cleanup.backend()?.0.try_wait()?;
    }
    observed(&mut lifecycle, output, "lease_loss_exits_fail_closed", lease_exit.is_some_and(|status| !status.success()))?;
    if lease_exit.is_none() { cleanup.backend()?.stop()?; }
    cleanup.process = Some(spawn_backend(&binary, &environment, &log, http_port)?);
    observed(&mut lifecycle, output, "replacement_acquires_lease_after_loss", true)?;
    restart_stale = Client::new(http_port)?;
    restart_stale.must("POST", "/api/auth/login", Some(json!({"email": "admin@parity.test", "password": PASSWORD})))?;
    let drain_entered = scratch.join("drain-entered");
    let drain_release = scratch.join("drain-release");
    cleanup.releases.push(drain_release.clone());
    barrier(&pg_bin, "pg_dump", "after", &drain_entered, &drain_release, false, false, None, "all")?;
    let mut client = clone_client(&restart_stale, http_port)?;
    let mut draining = cleanup.submit(move || request(&mut client, "POST", "/api/backups", None));
    let drain = (|| -> Result<()> {
        wait_until(|| Ok(drain_entered.exists()), "Drain backup did not reach barrier", 30)?;
        cleanup.backend()?.terminate()?;
        thread::sleep(Duration::from_millis(200));
        check!(cleanup.backend()?.0.try_wait()?.is_none(), "SIGTERM did not drain the in-flight backup");
        let (success, second_output) = second_instance(&binary, &environment)?;
        check!(!success && second_output.contains("Another InventoryMGR instance"), "Lease released before graceful drain finished");
        Ok(())
    })();
    File::create(&drain_release)?;
    drain?;
    check!(draining.result(20)?.0 == 201, "Draining backup did not return HTTP 201");
    check!(cleanup.backend()?.wait(Duration::from_secs(20))?.success(), "Graceful drain exited unsuccessfully");
    observed(&mut lifecycle, output, "lease_retained_through_graceful_drain", true)?;
    clear_barrier(&pg_bin, "pg_dump")?;
    cleanup.process = Some(spawn_backend(&binary, &environment, &log, http_port)?);
    results.as_object_mut().ok_or("Results are not an object")?.extend(lifecycle.as_object().ok_or("Lifecycle is not an object")?.clone());

    check!(cleanup.backend()?.stop()?.success(), "SIGTERM after restart failed");
    File::create(&auth_guard)?;
    cleanup.process = Some(spawn_backend(&binary, &environment, &log, http_port)?);
    check!(request(&mut restart_stale, "GET", "/api/auth/me", None)?.0 == 401, "Restart ignored restore-auth guard");
    check!(request(&mut restart_stale, "POST", "/api/auth/refresh", None)?.0 == 401, "Restart ignored restore-auth guard for refresh");
    check!(request(&mut Client::new(http_port)?, "POST", "/api/auth/login", Some(json!({"email": "admin@parity.test", "password": PASSWORD})))?.0 == 401, "Restart issued tokens before restore recovery");
    check!(auth_guard.exists(), "Startup reconciliation removed restore-auth guard");
    results["restore_marker_remains_fail_closed_after_restart"] = json!(true);
    common::write_json(output.join("results.json"), &results)?;
    println!("{}", serde_json::to_string(&results)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_restore_evidence() {
        let mut client = Client::new(1).unwrap();
        let masked = client.normalize(json!({
            "id": "00000000-0000-0000-0000-000000000001", "started_at": "2026-01-01T00:00:00Z",
            "kind": "restore", "size_bytes": 42, "filename": "tmpfixture.dump",
        }), "");
        assert_eq!(masked, json!({"id": "<uuid:0>", "started_at": "<timestamp>", "kind": "restore", "size_bytes": "<nonempty-dump>", "filename": "<restore-upload>.dump"}));
    }
}
