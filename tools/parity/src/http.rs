#[path = "http_client.rs"]
pub(crate) mod http_client;
use http_client::{Client, Upload, PASSWORD, SPEC, ZERO};
use crate::common::Result;
use serde_json::{json, Value};
use std::{fs, path::Path, process::Command};
use sha2::{Digest, Sha256};
fn id(value: Value) -> Result<String> { Ok(value["id"].as_str().ok_or("Response missing id")?.to_owned()) }
fn ensure(ok: bool, message: &str) -> Result<()> { if ok { Ok(()) } else { Err(message.to_owned().into()) } }
fn transcript_diff(expected: &Value, actual: &Value) -> Result<String> {
    if expected == actual { return Ok(String::new()); }
    if let (Value::Array(left), Value::Array(right)) = (expected, actual) {
        let mut diff = String::from("--- frozen-python\n+++ rust\n");
        for index in 0..left.len().max(right.len()) {
            let (a, b) = (left.get(index), right.get(index));
            if a == b { continue; }
            diff.push_str(&format!("@@ case {index} @@\n"));
            for line in serde_json::to_string_pretty(&a)?.lines() { diff.push_str(&format!("-{line}\n")); }
            for line in serde_json::to_string_pretty(&b)?.lines() { diff.push_str(&format!("+{line}\n")); }
        }
        return Ok(diff);
    }
    let left = serde_json::to_string_pretty(expected)?; let right = serde_json::to_string_pretty(actual)?;
    let mut diff = format!("--- frozen-python\n+++ rust\n@@ -1,{} +1,{} @@\n", left.lines().count(), right.lines().count());
    for line in left.lines() { diff.push_str(&format!("-{line}\n")); }
    for line in right.lines() { diff.push_str(&format!("+{line}\n")); }
    Ok(diff)
}
struct Ordered<T>(Vec<(String, T)>);
impl<'de, T: serde::Deserialize<'de>> serde::Deserialize<'de> for Ordered<T> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        struct Visitor<T>(std::marker::PhantomData<T>);
        impl<'de, T: serde::Deserialize<'de>> serde::de::Visitor<'de> for Visitor<T> {
            type Value = Ordered<T>;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("an ordered object") }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> std::result::Result<Self::Value, A::Error> { let mut entries = Vec::new(); while let Some(entry) = map.next_entry()? { entries.push(entry); } Ok(Ordered(entries)) }
        }
        deserializer.deserialize_map(Visitor(std::marker::PhantomData))
    }
}
#[derive(serde::Deserialize)]
struct FrozenSpec { paths: Ordered<Ordered<Value>> }
fn suite(c: &mut Client) -> Result<()> {
    c.must("GET", "/api/health", None)?; c.must("GET", "/api/auth/setup", None)?;
    c.call("POST", "/api/auth/setup", Some(json!({})))?;
    c.call("POST", "/api/auth/setup", Some(json!({"email":"bad@parity.test","password":"short"})))?;
    c.call("POST", "/api/auth/login", Some(json!({})))?; c.call("POST", "/api/auth/refresh", None)?;
    // Request order is part of the frozen transcript; serde_json::Value sorts object keys.
    let spec: FrozenSpec = serde_json::from_str(SPEC)?;
    let placeholder = regex::Regex::new(r"\{[^}]+\}")?;
    for (path, methods) in spec.paths.0 { for (method, _) in methods.0 {
        if !["get","post","put","patch","delete"].contains(&method.as_str()) || path.starts_with("/api/auth/") { continue; }
        let concrete = placeholder.replace_all(&path, ZERO).into_owned();
        c.request(&method.to_uppercase(), &concrete, if method == "get" { None } else { Some(json!({})) }, true, None, Some(&format!("unauthenticated {method} {path}")))?;
    } }
    c.must("POST", "/api/auth/setup", Some(json!({"email":"admin@parity.test","password":PASSWORD})))?;
    c.call("POST", "/api/auth/setup", Some(json!({"email":"other@parity.test","password":PASSWORD})))?;
    c.must("GET", "/api/auth/me", None)?;
    c.call("POST", "/api/auth/login", Some(json!({"email":"admin@parity.test","password":"wrong"})))?;
    let mut users = std::collections::BTreeMap::new();
    for role in ["editor","viewer"] { users.insert(role, id(c.must("POST", "/api/users", Some(json!({"email":format!("{role}@parity.test"),"password":PASSWORD,"role":role})))?)?); }
    c.must("GET", "/api/users", None)?; c.call("POST", "/api/users", Some(json!({})))?;
    c.call("POST", "/api/users", Some(json!({"email":"bad@parity.test","password":PASSWORD,"role":"unknown"})))?;
    c.call("PATCH", "/api/settings/app", Some(json!({"decommission_notify_days":0})))?;
    c.call("PUT", "/api/settings/ldap", Some(json!({})))?;
    c.must("PATCH", &format!("/api/users/{}", users["editor"]), Some(json!({"is_active":true})))?;
    c.must("PUT", "/api/user/accent", Some(json!({"accent":"blue"})))?;
    c.call("PUT", "/api/user/accent", Some(json!({"accent":"invalid"})))?;
    c.request("PUT", "/api/user/accent", Some(json!({"accent":"orange"})), false, None, None)?;
    c.must("PUT", "/api/user/preferences/inventory", Some(json!({"columns":[{"key":"ip_address","visible":true,"order":0}]})))?;
    c.must("GET", "/api/user/preferences/inventory", None)?; c.must("GET", "/api/user/accent", None)?;
    c.must("PATCH", "/api/settings/app", Some(json!({"decommission_notify_days":42,"storage_usage_warn_pct":75})))?;
    c.must("PUT", "/api/settings/ldap", Some(json!({"enabled":false,"server_uri":"ldap://127.0.0.1:1","user_base_dn":"dc=parity,dc=test"})))?;
    c.call("POST", "/api/settings/ldap/test", None)?;
    for path in ["/api/settings/app","/api/settings/options","/api/settings/ldap"] { c.must("GET", path, None)?; }
    let vm = json!({"name":"parity-vm-2","platform":"proxmox","cluster":"parity-cluster","status":"running","cpu_cores":4,"memory_mb":8192,"criticality":"high","os_family":"linux","owner":"ops","tags":["parity"],"disks":[{"disk_name":"boot","size_gb":32}],"networks":[{"ip_address":"192.0.2.10/24","role":"private"}]});
    let ident = id(c.must("POST", "/api/vms", Some(vm.clone()))?)?; let vp = format!("/api/vms/{ident}");
    c.must("GET", &vp, None)?; c.must("PATCH", &vp, Some(json!({"owner":"new-owner","monitoring_enabled":true})))?;
    c.call("POST", "/api/vms", Some(json!({"name":"","cpu_cores":-1})))?;
    c.call("PATCH", &vp, Some(json!({"status":"not-a-status"})))?; c.call("GET", "/api/vms/not-a-uuid", None)?;
    let clone = id(c.must("POST", &format!("{vp}/clone"), None)?)?;
    for (kind,payload,patch) in [("disks",json!({"disk_name":"data","size_gb":64}),json!({"size_gb":128})),("networks",json!({"ip_address":"192.0.2.11","role":"public"}),json!({"role":"backup"})),("applications",json!({"app_name":"parity-app","app_owner":"ops"}),json!({"description":"updated"}))] {
        let path = format!("{vp}/{kind}"); let child = id(c.must("POST", &path, Some(payload))?)?; c.must("GET", &path, None)?; c.must("PATCH", &format!("{path}/{child}"), Some(patch))?; c.must("DELETE", &format!("{path}/{child}"), None)?;
    }
    c.must("POST", "/api/vms/bulk", Some(json!({"ids":[ident,ZERO],"patch":{"tags_add":["bulk"],"tags_remove":["parity"]}})))?;
    c.must("POST", "/api/vms/bulk", Some(json!({"filters":{"cluster":["parity-cluster"]},"patch":{"owner":"bulk-owner"}})))?;
    c.call("POST", "/api/vms/bulk", Some(json!({"patch":{"name":"forbidden"}})))?;
    for query in ["","?limit=1&offset=1&sort=name&dir=desc","?status=running&status=stopped","?q=bulk-owner","?cluster=parity-cluster","?missing_ip=true","?platform=invalid","?limit=-1"] { c.call("GET", &format!("/api/vms{query}"), None)?; }
    for endpoint in ["clusters","nodes","owners","tags","applications","suggestions"] { c.call("GET", &format!("/api/vms/{endpoint}"), None)?; }
    c.must("GET", &format!("{vp}/audit?limit=50"), None)?;
    for fmt in ["csv","xlsx"] { c.must("GET", &format!("/api/vms/export?format={fmt}"), None)?; }
    let cluster = id(c.must("POST", "/api/clusters", Some(json!({"name":"physical-parity"})))?)?; let cp = format!("/api/clusters/{cluster}");
    c.must("GET", "/api/clusters", None)?; c.must("GET", &cp, None)?; c.must("PATCH", &cp, Some(json!({"description":"updated"})))?;
    let node = id(c.must("POST", &format!("{cp}/nodes"), Some(json!({"name":"node-1","cpu_cores":8,"ram_total_gb":64})))?)?;
    c.must("GET", &format!("{cp}/nodes"), None)?; c.must("PATCH", &format!("{cp}/nodes/{node}"), Some(json!({"cpu_cores":16})))?; c.must("DELETE", &format!("{cp}/nodes/{node}"), None)?;
    let array = id(c.must("POST", "/api/storage/arrays", Some(json!({"name":"parity-array","vendor":"netapp","total_capacity_gb":1000,"used_capacity_gb":800})))?)?; let ap = format!("/api/storage/arrays/{array}");
    c.must("GET", "/api/storage/arrays", None)?; c.must("GET", &ap, None)?; c.must("PATCH", &ap, Some(json!({"description":"updated"})))?;
    let volume = id(c.must("POST", &format!("{ap}/volumes"), Some(json!({"name":"parity-vol","size_gb":500})))?)?;
    c.must("GET", &format!("{ap}/volumes"), None)?; c.must("PATCH", &format!("{ap}/volumes/{volume}"), Some(json!({"name":"renamed-vol"})))?;
    for (kind,payload,patch) in [("luns",json!({"name":"lun-1","size_gb":50}),json!({"size_gb":60})),("shares",json!({"export_path":"/parity"}),json!({"notes":"updated"}))] {
        let path = format!("/api/storage/volumes/{volume}/{kind}"); let child = id(c.must("POST", &path, Some(payload))?)?; c.must("GET", &path, None)?; c.must("PATCH", &format!("{path}/{child}"), Some(patch))?; c.must("DELETE", &format!("{path}/{child}"), None)?;
    }
    let before = c.must("GET", "/api/dashboard", None)?;
    let mut tagged = vm.clone(); tagged["name"] = json!("tmpl-excluded"); tagged["tags"] = json!(["Template"]); tagged["networks"] = json!([]); tagged["decommission_date"] = json!("2000-01-01");
    let tmpl = id(c.must("POST", "/api/vms", Some(tagged.clone()))?)?; tagged["name"] = json!("backup-excluded"); tagged["tags"] = json!(["BACKUP"]); let bkp = id(c.must("POST", "/api/vms", Some(tagged))?)?;
    let after = c.must("GET", "/api/dashboard", None)?; ensure(before["total"] == after["total"], "Dashboard total includes template/backup tags")?;
    let excluded = c.must("GET", "/api/vms?q=excluded&missing_ip=true", None)?; ensure(excluded["items"] == json!([]), "Excluded VMs leaked into missing-IP alerts")?;
    let ordinary = c.must("GET", "/api/vms?q=excluded", None)?; ensure(ordinary["total"] == json!(2), "Ordinary inventory lost tagged VMs")?;
    let due = c.must("GET", "/api/notifications/decommissions", None)?; ensure(!due.as_array().ok_or("Notifications must be array")?.iter().any(|r| r["vm_id"] == json!(tmpl) || r["vm_id"] == json!(bkp)), "Excluded VMs leaked into notifications")?;
    c.must("DELETE", &format!("/api/vms/{tmpl}"), None)?; c.must("DELETE", &format!("/api/vms/{bkp}"), None)?;
    c.must("GET", "/api/reports/summary", None)?;
    for name in ["linux","windows","missing"] { c.call("GET", &format!("/api/reports/{name}?format=csv"), None)?; }
    for path in ["/api/notifications/decommissions","/api/notifications/duplicate-ips"] { c.must("GET", path, None)?; }
    c.must("POST", "/api/notifications/decommissions/ack", Some(json!({"vm_ids":[ident]})))?;
    c.must("GET", "/api/imports/template", None)?;
    let content = b"name,platform,cluster,status,cpu_cores,memory_mb,criticality\nimported-parity,proxmox,parity-cluster,running,2,2048,low\n";
    let batch = id(c.must_upload("POST", "/api/imports/preview", None, Some(Upload { filename:"parity.csv",content,mime:"text/csv",fields:&[] }))?)?;
    c.must("GET", &format!("/api/imports/{batch}"), None)?;
    c.must("POST", &format!("/api/imports/{batch}/commit"), Some(json!({})))?; c.call("POST", &format!("/api/imports/{batch}/commit"), Some(json!({})))?;
    c.request("POST", "/api/imports/preview", None, true, Some(Upload {filename:"wrong.txt",content:b"bad",mime:"text/plain",fields:&[]}), None)?;
    c.must("GET", "/api/backups", None)?; c.must("PATCH", "/api/backups/settings", Some(json!({"enabled":false,"hour_utc":3,"retention":2})))?;
    c.call("GET", "/api/backups/missing.dump/download", None)?; c.call("DELETE", "/api/backups/missing.dump", None)?;
    c.request("POST", "/api/backups/restore", None, true, Some(Upload {filename:"bad.dump",content:b"not-a-dump",mime:"application/octet-stream",fields:&[("confirm","WRONG")]}), None)?;
    let backup = c.must("POST", "/api/backups", None)?; let filename = backup["filename"].as_str().ok_or("Backup missing filename")?;
    let (status, _, dump) = c.request("GET", &format!("/api/backups/{filename}/download"), None, true, None, None)?; ensure(status == 200 && dump.starts_with(b"PGDMP"), "Backup download is not a real PostgreSQL custom dump")?;
    c.must("DELETE", &format!("/api/backups/{filename}"), None)?;
    for role in ["viewer","editor"] {
        c.clear_cookies()?; c.must("POST", "/api/auth/login", Some(json!({"email":format!("{role}@parity.test"),"password":PASSWORD,"remember":role == "editor"})))?;
        c.must("POST", "/api/auth/refresh", None)?;
        for path in ["/api/users","/api/settings/ldap","/api/backups","/api/vms","/api/clusters","/api/storage/arrays"] { c.call("GET", path, None)?; }
        c.call("PATCH", &vp, Some(json!({"description":role})))?; c.request("PATCH", &vp, Some(json!({"description":role})), false, None, None)?; c.call("DELETE", &vp, None)?;
        c.must("PUT", "/api/user/accent", Some(json!({"accent":"violet"})))?; c.must("POST", "/api/auth/logout", None)?; c.call("GET", "/api/auth/me", None)?;
    }
    c.must("POST", "/api/auth/login", Some(json!({"email":"admin@parity.test","password":PASSWORD})))?;
    for path in [format!("{ap}/volumes/{volume}"),ap,cp,format!("/api/vms/{clone}"),vp,format!("/api/users/{}",users["viewer"])] { c.must("DELETE", &path, None)?; }
    c.must_upload("POST", "/api/backups/restore", None, Some(Upload {filename:"parity.dump",content:&dump,mime:"application/octet-stream",fields:&[("confirm","RESTORE")]}))?;
    c.call("GET", "/api/auth/me", None)?; c.call("POST", "/api/auth/refresh", None)?;
    c.must("POST", "/api/auth/login", Some(json!({"email":"admin@parity.test","password":PASSWORD})))?; c.must("GET", "/api/vms", None)?;
    c.check_coverage()?; Ok(())
}

use crate::common::Process as Backend;
use crate::common::write_json;
pub fn run(binary: &Path, output: &Path, scratch: &Path, image: Option<&str>) -> Result<()> {
    fs::create_dir_all(output)?; fs::create_dir_all(scratch)?;
    let temporary = crate::common::Scratch::new(scratch, "inventorymgr-rust-parity-")?;
    run_isolated(binary, output, &temporary.0, image)
}
fn run_isolated(binary: &Path, output: &Path, scratch: &Path, image: Option<&str>) -> Result<()> {
    let container = crate::common::Container::start_with_image(image.unwrap_or(crate::common::POSTGRES_IMAGE))?;
    let port = container.port;
    container.create_db("parity_rust")?;
    let http_port = crate::common::free_port()?;
    let backups = scratch.join("rust/backups"); let pg_bin = scratch.join("rust/pg-bin"); fs::create_dir_all(&backups)?; fs::create_dir_all(&pg_bin)?; crate::common::install_bridge(&pg_bin)?;
    let log = fs::File::create(output.join("rust.log"))?;
    let mut backend = Backend(Command::new(binary.canonicalize()?).env("APP_ENV","test").env("DATABASE_URL",format!("postgresql://postgres@127.0.0.1:{port}/parity_rust")).env("JWT_SECRET", crate::common::token(32)).env("BACKUP_DIR",backups.canonicalize()?).env("HOST","127.0.0.1").env("PORT",http_port.to_string()).env("BIND_ADDR",format!("127.0.0.1:{http_port}")).env("PG_BIN_DIR",pg_bin.canonicalize()?).env("PARITY_PG_CONTAINER",&container.name).env("PARITY_PG_URL","postgresql://postgres@127.0.0.1:5432/parity_rust").stdout(log.try_clone()?).stderr(log).spawn()?);
    crate::common::wait_ready(&mut backend.0, http_port)?;
    let mut client = Client::new(http_port)?;
    if let Err(error) = suite(&mut client) {
        let actual = json!(client.records);
        write_json(output.join("rust.partial.json"), &actual)?;
        let expected: Value = serde_json::from_str(include_str!("../http_baseline.json"))?;
        fs::write(output.join("parity.diff"), transcript_diff(&expected, &actual)?)?;
        return Err(error);
    }
    backend.stop()?;
    write_json(output.join("rust.json"), &json!(client.records))?;
    let expected: Value = serde_json::from_str(include_str!("../http_baseline.json"))?;
    let actual = json!(client.records); let matches = expected == actual;
    let diff = transcript_diff(&expected, &actual)?;
    fs::write(output.join("parity.diff"),diff)?;
    let metadata = json!({"openapi_sha256":format!("{:x}",Sha256::digest(SPEC.as_bytes())),"http_baseline_sha256":format!("{:x}",Sha256::digest(include_bytes!("../http_baseline.json"))),"rust_cases":client.records.len(),"frozen_operations":client.check_coverage()?,"isolated_database":true,"oracle":"frozen-python","python_runtime_required":false,"matches_baseline":matches});
    write_json(output.join("manifest.json"), &metadata)?;
    ensure(matches,"HTTP parity mismatch: see parity.diff")?; println!("{metadata}"); Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_request_order_and_emits_diff() {
        let spec: FrozenSpec = serde_json::from_str(r#"{"paths":{"/z":{"post":{},"get":{}},"/a":{"delete":{}}}}"#).unwrap();
        assert_eq!(spec.paths.0[0].0, "/z");
        assert_eq!(spec.paths.0[0].1.0[0].0, "post");
        assert_eq!(transcript_diff(&json!(1), &json!(1)).unwrap(), "");
        assert_eq!(transcript_diff(&json!(1), &json!(2)).unwrap(), "--- frozen-python\n+++ rust\n@@ -1,1 +1,1 @@\n-1\n+2\n");
    }
}
