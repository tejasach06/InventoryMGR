use inventorymgr_parity::{common, http, migrations, restore};
use std::path::PathBuf;

const USAGE: &str = "Usage: parity <http|migrations|restore-concurrency> --rust-binary PATH --output DIR [--scratch-dir DIR] [--postgres-image IMAGE]";

fn run() -> common::Result<()> {
    let mut arguments = std::env::args().skip(1);
    let Some(subcommand) = arguments.next() else { return Err(USAGE.into()); };
    if matches!(subcommand.as_str(), "--help" | "-h") {
        println!("{USAGE}");
        return Ok(());
    }
    if !matches!(subcommand.as_str(), "http" | "migrations" | "restore-concurrency") {
        return Err(format!("Unknown subcommand {subcommand}\n{USAGE}").into());
    }
    let mut binary = None;
    let mut output = None;
    let mut scratch = common::root().join(".parity-scratch");
    let mut postgres_image = None;
    while let Some(flag) = arguments.next() {
        if matches!(flag.as_str(), "--help" | "-h") {
            println!("{USAGE}");
            return Ok(());
        }
        if !matches!(flag.as_str(), "--rust-binary" | "--output" | "--scratch-dir" | "--postgres-image") || (matches!(flag.as_str(), "--scratch-dir" | "--postgres-image") && subcommand != "http") {
            return Err(format!("Unknown argument {flag}\n{USAGE}").into());
        }
        let value = arguments.next().ok_or_else(|| format!("Missing value for {flag}"))?;
        match flag.as_str() {
            "--rust-binary" => binary = Some(PathBuf::from(value)),
            "--output" => output = Some(PathBuf::from(value)),
            "--scratch-dir" => scratch = PathBuf::from(value),
            "--postgres-image" => postgres_image = Some(value),
            _ => unreachable!(),
        }
    }
    let binary = binary.ok_or("Missing --rust-binary")?.canonicalize()?;
    let output = output.ok_or("Missing --output")?;
    std::fs::create_dir_all(&output)?;
    let output = output.canonicalize()?;
    match subcommand.as_str() {
        "http" => {
            std::fs::create_dir_all(&scratch)?;
            http::run(&binary, &output, &scratch.canonicalize()?, postgres_image.as_deref())
        }
        "migrations" => migrations::run(&binary, &output),
        "restore-concurrency" => restore::run(&binary, &output),
        _ => unreachable!(),
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
