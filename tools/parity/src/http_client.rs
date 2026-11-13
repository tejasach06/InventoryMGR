use crate::common::Result;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read};

pub const PASSWORD: &str = "parity-only-correct-horse-battery";
pub const ZERO: &str = "00000000-0000-0000-0000-000000000001";
pub const SPEC: &str = include_str!("../openapi_baseline.json");
const VOLATILE: &[&str] = &["created_at", "updated_at", "started_at", "finished_at", "last_login_at", "expires_at", "changed_at"];
pub struct Upload<'a> { pub filename: &'a str, pub content: &'a [u8], pub mime: &'a str, pub fields: &'a [(&'a str, &'a str)] }
pub struct Client {
    base: String,
    http: reqwest::blocking::Client,
    cookies: BTreeMap<String, String>,
    pub records: Vec<Value>,
    ids: Vec<(String, String)>,
    pub covered: BTreeSet<(String, String)>,
    spec: Value,
}
fn re(pattern: &str) -> Regex { Regex::new(pattern).expect("constant regex") }
fn masked_case(text: &str) -> String {
    let text = re(r"\d{8}T\d{6}Z").replace_all(text, "<timestamp>");
    re(r"-[0-9a-f]{32}(\.dump)").replace_all(&text, "$1").into_owned()
}
impl Client {
    pub fn new(port: u16) -> Result<Self> {
        Ok(Self { base: format!("http://127.0.0.1:{port}"), http: reqwest::blocking::Client::builder().cookie_store(true).timeout(std::time::Duration::from_secs(45)).build()?, cookies: BTreeMap::new(), records: Vec::new(), ids: Vec::new(), covered: BTreeSet::new(), spec: serde_json::from_str(SPEC)? })
    }
    pub fn clear_cookies(&mut self) -> Result<()> { self.cookies.clear(); self.http = reqwest::blocking::Client::builder().cookie_store(true).timeout(std::time::Duration::from_secs(45)).build()?; Ok(()) }
    pub fn cookies(&self) -> &BTreeMap<String, String> {
        &self.cookies
    }
    pub fn set_cookies(&mut self, cookies: BTreeMap<String, String>) -> Result<()> {
        let jar = reqwest::cookie::Jar::default();
        let url = self.base.parse()?;
        for (name, value) in &cookies {
            jar.add_cookie_str(&format!("{name}={value}; Path=/"), &url);
        }
        self.http = reqwest::blocking::Client::builder()
            .cookie_provider(std::sync::Arc::new(jar))
            .timeout(std::time::Duration::from_secs(45))
            .build()?;
        self.cookies = cookies;
        Ok(())
    }
    pub fn normalize(&mut self, mut value: Value, key: &str) -> Value {
        match &mut value {
            Value::Object(map) => {
                if map.get("type") == Some(&json!("uuid_parsing")) && map.contains_key("loc") {
                    map.remove("msg");
                    if let Some(Value::Object(ctx)) = map.get_mut("ctx") { ctx.remove("error"); if ctx.is_empty() { map.remove("ctx"); } }
                }
                if matches!(map.get("kind").and_then(Value::as_str), Some("manual" | "restore" | "pre_restore")) && map.get("size_bytes").and_then(Value::as_u64).unwrap_or(0) > 0 { map.insert("size_bytes".into(), json!("<nonempty-dump>")); }
                let mut keys: Vec<_> = map.keys().cloned().collect(); keys.sort();
                for k in keys { let v = map.remove(&k).unwrap(); map.insert(k.clone(), self.normalize(v, &k)); }
            }
            Value::Array(items) => { for item in items { *item = self.normalize(item.take(), key); } }
            Value::String(text) => {
                if re(r"^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$").is_match(text) {
                    let alias = if let Some((_, alias)) = self.ids.iter().find(|(id, _)| id == text) { alias.clone() } else { let alias = format!("<uuid:{}>", self.ids.len()); self.ids.push((text.clone(), alias.clone())); alias }; *text = alias;
                } else if VOLATILE.contains(&key) { *text = "<timestamp>".into(); }
                else if key == "filename" && re(r"^tmp[^/]+\.dump$").is_match(text) { *text = "<restore-upload>.dump".into(); }
                else if re(r"^inventorymgr-\d{8}T\d{6}Z-.*\.dump$").is_match(text) { *text = masked_case(text); }
            }
            _ => {}
        }
        value
    }
    pub fn request(&mut self, method: &str, path: &str, payload: Option<Value>, csrf: bool, upload: Option<Upload<'_>>, label: Option<&str>) -> Result<(u16, Value, Vec<u8>)> {
        let mut request = self.http.request(method.parse()?, format!("{}{path}", self.base));
        if csrf && !["GET", "HEAD", "OPTIONS"].contains(&method) && let Some(token) = self.cookies.get("inventorymgr_csrf") { request = request.header("X-CSRF-Token", token); }
        if let Some(payload) = payload { request = request.json(&payload); }
        if let Some(upload) = upload {
            let boundary = "inventorymgr-parity-boundary";
            let mut data = Vec::new();
            for (name, value) in upload.fields { data.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes()); }
            data.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\nContent-Type: {}\r\n\r\n", upload.filename, upload.mime).as_bytes()); data.extend_from_slice(upload.content); data.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
            request = request.header("Content-Type", format!("multipart/form-data; boundary={boundary}")).body(data);
        }
        let response = request.send()?;
        let status = response.status().as_u16(); let headers = response.headers().clone(); let raw = response.bytes()?.to_vec();
        let content_type = headers.get("Content-Type").and_then(|v| v.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("");
        let body = if let Ok(body) = serde_json::from_slice::<Value>(&raw) { body }
        else if content_type.contains("spreadsheetml") { xlsx(&raw)? }
        else if content_type == "text/csv" {
            let mut rows = python_csv(std::str::from_utf8(&raw)?);
            if let Some(head) = rows.first().cloned() { for row in rows.iter_mut().skip(1) { for (i, key) in head.iter().enumerate() { if VOLATILE.contains(&key.as_str()) && let Some(v) = row.get_mut(i) && !v.is_empty() { *v = "<timestamp>".into(); } } } } json!(rows)
        } else if ["application/octet-stream", "application/x-postgresql-dump"].contains(&content_type) { json!({"nonempty": !raw.is_empty(), "postgres_dump": raw.starts_with(b"PGDMP")}) }
        else { let mut text = String::from_utf8_lossy(&raw).into_owned(); for (id, alias) in &self.ids { text = text.replace(id, alias); } json!(text) };
        let mut cookies = serde_json::Map::new();
        for header in headers.get_all("Set-Cookie") {
            let mut parts = header.to_str()?.split(';');
            if let Some((name, value)) = parts.next().and_then(|p| p.trim().split_once('=')) {
                let mut attrs = serde_json::Map::new(); let mut remove = value.is_empty();
                for part in parts { let (key, val) = part.trim().split_once('=').unwrap_or((part.trim(), "")); let key = key.to_ascii_lowercase(); if key == "max-age" && val.parse::<i64>().unwrap_or(1) <= 0 { remove = true; }
                    if ["expires", "path", "comment", "domain", "max-age", "secure", "httponly", "version", "samesite"].contains(&key.as_str()) { if key == "secure" || key == "httponly" { attrs.insert(key, json!(true)); } else if !val.is_empty() { let val = val.trim_matches('"'); attrs.insert(key.clone(), json!(if key == "expires" { "<timestamp>".to_owned() } else if key == "samesite" { val.to_ascii_lowercase() } else { val.to_owned() })); } }
                }
                if remove { self.cookies.remove(name); } else { self.cookies.insert(name.to_owned(), value.trim_matches('"').to_owned()); } cookies.insert(name.to_owned(), Value::Object(attrs));
            }
        }
        let normalized = self.normalize(body.clone(), ""); let mut case = label.map(str::to_owned).unwrap_or_else(|| format!("{method} {path}")); for (id, alias) in &self.ids { case = case.replace(id, alias); }
        let mut security = serde_json::Map::new(); for name in ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"] { if let Some(value) = headers.get(name) { security.insert(name.to_ascii_lowercase(), json!(value.to_str()?)); } }
        self.records.push(json!({"case": masked_case(&case), "status": status, "content_type": content_type, "body": normalized, "cookies": cookies, "headers": security}));
        for (template, operations) in self.spec["paths"].as_object().unwrap() { if operations.get(method.to_ascii_lowercase()).is_some() { let pattern = format!("^{}$", re(r"\{[^}]+\}").replace_all(template, "[^/]+")); if re(&pattern).is_match(path.split('?').next().unwrap()) { self.covered.insert((method.to_ascii_lowercase(), template.clone())); } } }
        Ok((status, body, raw))
    }
    pub fn call(&mut self, method: &str, path: &str, payload: Option<Value>) -> Result<Value> { Ok(self.request(method, path, payload, true, None, None)?.1) }
    pub fn must(&mut self, method: &str, path: &str, payload: Option<Value>) -> Result<Value> { self.must_upload(method, path, payload, None) }
    pub fn must_upload(&mut self, method: &str, path: &str, payload: Option<Value>, upload: Option<Upload<'_>>) -> Result<Value> { let (status, body, _) = self.request(method, path, payload, true, upload, None)?; if !(200..300).contains(&status) { return Err(format!("{method} {path}: expected success, got {status}: {body}").into()); } Ok(body) }
    pub fn check_coverage(&self) -> Result<usize> { let mut missing = Vec::new(); let mut count = 0; for (path, methods) in self.spec["paths"].as_object().unwrap() { for method in methods.as_object().unwrap().keys() { if ["get", "post", "put", "patch", "delete"].contains(&method.as_str()) { count += 1; if !self.covered.contains(&(method.clone(), path.clone())) { missing.push(format!("{method} {path}")); } } } } if !missing.is_empty() { return Err(format!("Frozen operations not exercised: {missing:?}").into()); } Ok(count) }
}
fn xml_events(bytes: &[u8]) -> Result<Vec<quick_xml::events::Event<'static>>> { let mut reader = quick_xml::Reader::from_reader(bytes); let mut out = Vec::new(); loop { let event = reader.read_event()?.into_owned(); if matches!(event, quick_xml::events::Event::Eof) { break; } out.push(event); } Ok(out) }
// Mirrors Python csv.reader(io.StringIO(text)): blank lines yield [] and a leading BOM stays in the first field.
// shortcut: bare \r mid-record ends the record where Python raises, upgrade if exports ever emit it.
fn python_csv(text: &str) -> Vec<Vec<String>> {
    #[derive(PartialEq)]
    enum State { RecordStart, FieldStart, InField, Quoted, QuoteInQuoted, EatLf }
    let (mut rows, mut row, mut field, mut state) = (Vec::new(), Vec::new(), String::new(), State::RecordStart);
    for c in text.chars() {
        if state == State::EatLf {
            state = State::RecordStart;
            if c == '\n' { continue; }
        }
        if state == State::RecordStart {
            if c == '\n' || c == '\r' {
                rows.push(Vec::new());
                if c == '\r' { state = State::EatLf; }
                continue;
            }
            state = State::FieldStart;
        }
        match (&state, c) {
            (State::FieldStart, '"') => state = State::Quoted,
            (State::FieldStart | State::InField | State::QuoteInQuoted, ',') => { row.push(std::mem::take(&mut field)); state = State::FieldStart; }
            (State::FieldStart | State::InField | State::QuoteInQuoted, '\n' | '\r') => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
                state = if c == '\r' { State::EatLf } else { State::RecordStart };
            }
            (State::Quoted, '"') => state = State::QuoteInQuoted,
            (State::QuoteInQuoted, '"') => { field.push('"'); state = State::Quoted; }
            (State::FieldStart | State::QuoteInQuoted, _) => { field.push(c); state = State::InField; }
            _ => field.push(c),
        }
    }
    if !matches!(state, State::RecordStart | State::EatLf) {
        row.push(field);
        rows.push(row);
    }
    rows
}
// Mirrors ElementTree itertext: text, CDATA and entity/char references all contribute.
fn xml_text(event: &quick_xml::events::Event<'_>) -> Result<String> {
    use quick_xml::events::Event;
    Ok(match event {
        // Raw content without EOL normalization, matching 0.40 `decode()`.
        Event::Text(e) => (**e).to_owned(),
        Event::CData(e) => (**e).to_owned(),
        Event::GeneralRef(e) => match e.resolve_char_ref()? {
            Some(character) => character.to_string(),
            None => quick_xml::escape::unescape(&format!("&{};", &**e))?.into_owned(),
        },
        _ => String::new(),
    })
}
fn xlsx(raw: &[u8]) -> Result<Value> {
    use quick_xml::events::Event;
    let mut archive = zip::ZipArchive::new(Cursor::new(raw))?;
    let mut shared = Vec::new();
    if let Ok(mut file) = archive.by_name("xl/sharedStrings.xml") { let mut bytes = Vec::new(); file.read_to_end(&mut bytes)?; let mut text = String::new(); for event in xml_events(&bytes)? { match event { Event::Start(e) if e.local_name().as_ref() == "si" => text.clear(), Event::Text(_) | Event::CData(_) | Event::GeneralRef(_) => text.push_str(&xml_text(&event)?), Event::End(e) if e.local_name().as_ref() == "si" => shared.push(text.clone()), _ => {} } } }
    let mut bytes = Vec::new(); archive.by_name("xl/worksheets/sheet1.xml")?.read_to_end(&mut bytes)?;
    let mut rows: Vec<BTreeMap<String,String>> = Vec::new(); let mut row = BTreeMap::new(); let mut column = String::new(); let mut kind = String::new(); let mut text = String::new(); let mut capture = false;
    for event in xml_events(&bytes)? { match event {
        Event::Start(e) if e.local_name().as_ref() == "row" => row.clear(),
        Event::Start(e) if e.local_name().as_ref() == "c" => { column.clear(); kind.clear(); text.clear(); for attr in e.attributes() { let attr = attr?; let value = attr.normalized_value(quick_xml::XmlVersion::Implicit1_0)?.into_owned(); match attr.key.as_ref() { "r" => column = value.chars().filter(|c| !c.is_ascii_digit()).collect(), "t" => kind = value, _ => {} } } },
        Event::Empty(e) if e.local_name().as_ref() == "c" => { for attr in e.attributes() { let attr = attr?; if attr.key.as_ref() == "r" { row.insert(attr.normalized_value(quick_xml::XmlVersion::Implicit1_0)?.chars().filter(|c| !c.is_ascii_digit()).collect(), String::new()); } } },
        Event::Start(e) if ["v", "t"].contains(&e.local_name().as_ref()) => capture = true,
        Event::End(e) if ["v", "t"].contains(&e.local_name().as_ref()) => capture = false,
        Event::Text(_) | Event::CData(_) | Event::GeneralRef(_) if capture => text.push_str(&xml_text(&event)?),
        Event::End(e) if e.local_name().as_ref() == "c" => { let value = if kind == "s" { shared.get(text.parse::<usize>()?).ok_or("Invalid shared string index")?.clone() } else { text.clone() }; row.insert(column.clone(), value); },
        Event::End(e) if e.local_name().as_ref() == "row" => rows.push(row.clone()), _ => {}
    } }
    if let Some(headers) = rows.first().cloned() { for row in rows.iter_mut().skip(1) { for (column, header) in &headers { if VOLATILE.contains(&header.as_str()) && let Some(value) = row.get_mut(column) && !value.is_empty() { *value = "<timestamp>".into(); } } } }
    Ok(json!({"rows": rows}))
}
#[cfg(test)]
mod tests { use super::*; #[test] fn masks_stable_ids_and_uuid_errors() { let mut c = Client::new(1).unwrap(); assert_eq!(c.normalize(json!({"id":ZERO,"created_at":"today"}), ""), json!({"id":"<uuid:0>","created_at":"<timestamp>"})); assert_eq!(c.normalize(json!({"type":"uuid_parsing","loc":["path"],"msg":"varies","ctx":{"error":"varies"}}), ""), json!({"type":"uuid_parsing","loc":["path"]})); assert_eq!(masked_case("inventorymgr-20260101T123456Z-abcd-0123456789abcdef0123456789abcdef.dump"), "inventorymgr-<timestamp>-abcd.dump"); } }
#[cfg(test)]
mod parser_tests {
    use super::*;
    use std::io::Write;

    fn workbook(shared: &str, sheet: &str) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, body) in [("xl/sharedStrings.xml", shared), ("xl/worksheets/sheet1.xml", sheet)] {
            writer.start_file(name, options).unwrap();
            writer.write_all(body.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn xlsx_keeps_entities_char_refs_and_cdata() {
        let shared = r#"<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>A&amp;B</t></si><si><t><![CDATA[x<y]]> &#65;&lt;</t></si></sst>"#;
        let sheet = r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>&quot;q&apos;</t></is></c></row></sheetData></worksheet>"#;
        assert_eq!(xlsx(&workbook(shared, sheet)).unwrap(), json!({"rows": [{"A": "A&B", "B": "x<y A<", "C": "\"q'"}]}));
    }

    #[test]
    fn xlsx_keeps_raw_line_endings_and_empty_cells() {
        let sheet = "<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>a\r\nb\ré</t></is></c><c r=\"B1\"/></row></sheetData></worksheet>";
        assert_eq!(xlsx(&workbook("<sst/>", sheet)).unwrap(), json!({"rows": [{"A": "a\r\nb\ré", "B": ""}]}));
    }

    #[test]
    fn csv_preserves_blank_records_and_bom() {
        assert_eq!(python_csv("\u{feff}a,b\r\n\r\n\"x\"\"y\",\"l1\nl2\",\n"), vec![vec!["\u{feff}a", "b"], vec![], vec!["x\"y", "l1\nl2", ""]]);
        assert_eq!(python_csv("a\n\n"), vec![vec!["a"], vec![]]);
        assert!(python_csv("").is_empty());
        assert_eq!(python_csv("\"open"), vec![vec!["open"]]);
    }
}
