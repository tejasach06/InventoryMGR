use crate::common::{Container, Process, Result, free_port, wait_ready, write_json};
use serde_json::{Value, json};
use std::fs::File;
use std::path::Path;
use std::process::{Command, Stdio};

const CATALOG: &str = "
SELECT jsonb_build_object(
'columns', (SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name, ordinal_position)
 FROM (SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default
 FROM information_schema.columns WHERE table_schema='public') c),
'constraints', (SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name,conname)
 FROM (SELECT cl.relname table_name,co.conname,pg_get_constraintdef(co.oid) definition
 FROM pg_constraint co JOIN pg_class cl ON cl.oid=co.conrelid
 JOIN pg_namespace ns ON ns.oid=cl.relnamespace WHERE ns.nspname='public') c),
'indexes', (SELECT jsonb_agg(to_jsonb(i) ORDER BY tablename,indexname)
 FROM (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public') i),
'enums', (SELECT jsonb_agg(to_jsonb(e) ORDER BY typname,enumsortorder)
 FROM (SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
 JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') e));
";

fn native(container: &Container, binary: &Path, output: &Path, database: &str, label: &str, expected: &Value, head: &str) -> Result<()> {
    let port = free_port()?;
    let env = container.env(database, port, &output.join("backups"));
    let mut process = Process::spawn(binary, &env, &output.join(format!("{label}.log")))?;
    wait_ready(&mut process.0, port)?;
    process.stop()?;
    let actual: Value = serde_json::from_str(&container.sql(database, CATALOG)?)?;
    write_json(output.join(format!("{label}.json")), &actual)?;
    if &actual != expected {
        return Err(format!("{label}: native catalog differs from Python Alembic head; inspect catalog JSON artifacts").into());
    }
    if container.sql(database, "SELECT version_num FROM alembic_version")? != head {
        return Err(format!("{label}: alembic_version is not Python head").into());
    }
    Ok(())
}

pub fn run(binary: &Path, output: &Path) -> Result<()> {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR"));
    let expected: Value = serde_json::from_slice(&std::fs::read(fixtures.join("migration_catalog.json"))?)?;
    let head = std::fs::read_to_string(fixtures.join("migration_head.txt"))?;
    let container = Container::start()?;
    let mut results = json!({});
    container.create_db("parity_empty")?;
    container.create_db("parity_upgrade")?;
    write_json(output.join("python-head.json"), &expected)?;
    for label in ["empty", "repeated"] {
        native(&container, binary, output, "parity_empty", label, &expected, head.trim())?;
        results[label] = json!("passed");
    }
    let historical = File::open(fixtures.join("historical_initial.sql"))?;
    let imported = Command::new("podman").args(["exec", "-i", &container.name, "psql", "-U", "postgres", "-d", "parity_upgrade", "-v", "ON_ERROR_STOP=1"]).stdin(historical).stdout(Stdio::null()).output()?;
    if !imported.status.success() {
        return Err(format!("Historical schema import failed: {}", String::from_utf8_lossy(&imported.stderr)).into());
    }
    container.sql("parity_upgrade", "INSERT INTO users(id,email,password_hash,role,is_active,created_at,updated_at) VALUES ('00000000-0000-0000-0000-000000000123','migration@parity.test','not-a-login-password','viewer',true,now(),now())")?;
    native(&container, binary, output, "parity_upgrade", "historical-upgrade", &expected, head.trim())?;
    results["historical-upgrade"] = json!("passed");
    if container.sql("parity_upgrade", "SELECT email FROM users WHERE id='00000000-0000-0000-0000-000000000123'")? != "migration@parity.test" {
        return Err("Historical upgrade lost the sentinel user".into());
    }
    results["historical-row-preserved"] = json!("passed");
    write_json(output.join("results.json"), &results)?;
    println!("{results}");
    Ok(())
}
