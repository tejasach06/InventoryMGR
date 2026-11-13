use crate::common::{Result, command};
use std::fs::File;
use std::path::Path;
use std::process::{Command, ExitStatus};
use url::Url;

fn raw_path(supplied: &str) -> &str {
    let hierarchy = supplied.split(['?', '#']).next().unwrap_or("");
    if let Some((_, rest)) = hierarchy.split_once("://") {
        rest.find('/').map_or("", |index| &rest[index..])
    } else {
        hierarchy
    }
}

pub fn validate_target(container: &str, supplied: &str) -> Result<Url> {
    let target = Url::parse(supplied)?;
    let authority = supplied.split_once("://").map(|(_, rest)| rest.split(['/', '?', '#']).next().unwrap_or(""));
    let parity = container.starts_with("inventorymgr-rust-parity-") && matches!(raw_path(supplied), "/parity_python" | "/parity_rust" | "/parity_restore");
    let e2e = container.starts_with("inventorymgr-e2e-") && raw_path(supplied) == "/inventorymgr_e2e";
    if target.scheme() != "postgresql" || authority != Some("postgres@127.0.0.1:5432") || !(parity || e2e) {
        return Err("Refusing a non-disposable PostgreSQL target".into());
    }
    Ok(target)
}

pub fn owned_database(database: &str, live_oid: &str) -> bool {
    if live_oid.is_empty() || !live_oid.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let prefix = format!("/im_restore_{live_oid}_");
    database.strip_prefix(&prefix).is_some_and(|suffix| suffix.len() == 32 && suffix.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
}

fn forwarded_url(container: &str, target: &Url, supplied: &str) -> Result<String> {
    let database = raw_path(supplied).to_owned();
    if database != target.path() {
        let live_oid = command(&["podman", "exec", container, "psql", target.as_str(), "-At", "-v", "ON_ERROR_STOP=1", "-c", "SELECT oid::bigint FROM pg_database WHERE datname=current_database()"])?;
        if !owned_database(&database, &live_oid) {
            return Err("Refusing an unowned PostgreSQL database".into());
        }
    }
    let mut forwarded = target.clone();
    forwarded.set_path(&database);
    Ok(forwarded.to_string())
}

pub fn run(binary: &str, args: &[String]) -> Result<ExitStatus> {
    let container = std::env::var("PARITY_PG_CONTAINER")?;
    let target = validate_target(&container, &std::env::var("PARITY_PG_URL")?)?;
    match binary {
        "pg_dump" => {
            let output = args.iter().find_map(|arg| arg.strip_prefix("--file=")).ok_or("Missing pg_dump --file=")?;
            let supplied = args.iter().find(|arg| arg.starts_with("postgresql://")).ok_or("Missing pg_dump database URL")?;
            let forwarded = forwarded_url(&container, &target, supplied)?;
            let destination = File::create(output)?;
            let status = Command::new("podman").args(["exec", &container, "pg_dump"]).args(args.iter().filter(|arg| !arg.starts_with("--file=") && !arg.starts_with("postgresql://"))).arg(forwarded).stdout(destination).status()?;
            barrier(binary, args, Some(output), "after")?;
            Ok(status)
        }
        "pg_restore" => {
            let (source, options) = args.split_last().ok_or("Missing pg_restore source")?;
            let mut forwarded = Vec::new();
            for arg in options {
                forwarded.push(if let Some(supplied) = arg.strip_prefix("--dbname=") {
                    format!("--dbname={}", forwarded_url(&container, &target, supplied)?)
                } else {
                    arg.clone()
                });
            }
            barrier(binary, args, None, "before")?;
            let incoming = File::open(source)?;
            Ok(Command::new("podman").args(["exec", "-i", &container, "pg_restore"]).args(forwarded).stdin(incoming).status()?)
        }
        _ => Err(format!("Unexpected PostgreSQL binary {binary}").into()),
    }
}

fn barrier(binary: &str, args: &[String], output: Option<&str>, phase: &str) -> Result<()> {
    let path = std::env::current_exe()?.with_file_name(format!("{binary}.barrier.json"));
    let contents = match std::fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let config: serde_json::Value = serde_json::from_slice(&contents)?;
    if config["phase"].as_str() != Some(phase) {
        return Ok(());
    }
    let has_live = args.iter().any(|arg| arg.starts_with("--dbname=") && arg.ends_with("/parity_restore"));
    let has_staging = args.iter().any(|arg| arg.starts_with("--dbname=") && !arg.ends_with("/parity_restore"));
    match config["scope"].as_str().unwrap_or("all") {
        "live" if !has_live => return Ok(()),
        "staging" if !has_staging => return Ok(()),
        "live" | "staging" | "all" => {}
        _ => return Err("Invalid bridge barrier scope".into()),
    }
    let entered = Path::new(config["entered"].as_str().ok_or("Missing bridge barrier entered path")?);
    let release = Path::new(config["release"].as_str().ok_or("Missing bridge barrier release path")?);
    if config["once"].as_bool().unwrap_or(false) && entered.exists() {
        return Ok(());
    }
    if config["write_output"].as_bool().unwrap_or(false) {
        std::fs::write(entered, output.ok_or("Missing dump output at bridge barrier")?)?;
    } else {
        std::fs::OpenOptions::new().create(true).append(true).open(entered)?;
    }
    let started = std::time::Instant::now();
    let timeout = if config.get("timeout_ms").is_some_and(serde_json::Value::is_null) {
        None
    } else {
        Some(std::time::Duration::from_millis(config["timeout_ms"].as_u64().unwrap_or(30_000)))
    };
    while !release.exists() {
        if timeout.is_some_and(|timeout| started.elapsed() >= timeout) {
            return Err(format!("{binary} barrier timed out").into());
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Ok(())
}

pub fn binary_name(path: &str) -> Result<&str> {
    let name = Path::new(path).file_name().and_then(|value| value.to_str()).ok_or("Invalid PostgreSQL binary name")?;
    Ok(name.strip_suffix(".exe").unwrap_or(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disposable_url_allowlist_is_exact() {
        for database in ["parity_python", "parity_rust", "parity_restore"] {
            assert!(validate_target("inventorymgr-rust-parity-test", &format!("postgresql://postgres@127.0.0.1:5432/{database}")).is_ok());
        }
        assert!(validate_target("inventorymgr-e2e-test", "postgresql://postgres@127.0.0.1:5432/inventorymgr_e2e").is_ok());
        for url in ["postgres://postgres@127.0.0.1:5432/parity_rust", "postgresql://postgres@localhost:5432/parity_rust", "postgresql://postgres:secret@127.0.0.1:5432/parity_rust", "postgresql://postgres@127.0.0.1/parity_rust", "postgresql://postgres@127.0.0.1:5432/production", "postgresql://postgres@127.0.0.1:5432/inventorymgr_e2e"] {
            assert!(validate_target("inventorymgr-rust-parity-test", url).is_err(), "{url}");
        }
        assert!(validate_target("production", "postgresql://postgres@127.0.0.1:5432/parity_rust").is_err());
        assert!(validate_target("inventorymgr-rust-parity-test", "postgresql://postgres@127.0.0.1:5432/other/../parity_rust").is_err());
        assert_eq!(raw_path("postgresql://ignored/other/../parity_rust?q=1#x"), "/other/../parity_rust");
    }

    #[test]
    fn staging_database_must_belong_to_live_oid() {
        let suffix = "0123456789abcdef0123456789abcdef";
        assert!(owned_database(&format!("/im_restore_123_{suffix}"), "123"));
        for database in [format!("/im_restore_124_{suffix}"), "/im_restore_123_unrelated".into(), format!("/im_restore_123_{}", suffix.to_uppercase()), format!("/im_restore_123_{suffix}x")] {
            assert!(!owned_database(&database, "123"));
        }
        assert!(!owned_database(&format!("/im_restore_123_{suffix}"), ""));
    }
}
