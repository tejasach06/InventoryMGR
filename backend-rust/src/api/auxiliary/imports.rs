use axum::{extract::{Multipart, Path, State}, http::{header,StatusCode}, response::{IntoResponse,Response}, Json};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::PgConnection;
use std::collections::{HashMap,HashSet};
use uuid::Uuid;
use crate::api::deps::{ApiError,AppState,Viewer,Editor,Csrf};
use crate::api::inventory::{
    MAX_CSV_BATCH_MAPPINGS, MAX_ENDPOINT_LENGTH, MAX_MAPPINGS_PER_VM, VIRTUAL_HOST_MAX_COUNT,
    VIRTUAL_HOST_MAX_LEN,
};
pub const MAX_CSV_MAPPINGS_PER_ROW: usize = MAX_MAPPINGS_PER_VM;
use super::db_error;

const COLUMNS: &[&str]=&["name","external_id","virtual_hosts","sr_id","platform","datacenter","cluster","node","status","environment","criticality","vm_type","cpu_cores","memory_mb","os_family","os_distribution","os_version","owner","business_owner","technical_owner","monitoring_enabled","pmp_enabled","ha_enabled","backup_enabled","backup_location","tags","last_patch_date","last_vuln_scan_date","last_verified_at","decommission_date","security_remarks","description"];
const TEMPLATE: &[&str]=&["name","external_id","virtual_hosts","sr_id","platform","datacenter","cluster","node","status","environment","criticality","vm_type","cpu_cores","memory_mb","disks","storage_name","storage_type","os_family","os_distribution","os_version","private_ip","public_ip","backup_ip","ip_mappings","owner","business_owner","technical_owner","applications","monitoring_enabled","pmp_enabled","ha_enabled","backup_enabled","backup_location","tags","last_patch_date","last_vuln_scan_date","last_verified_at","decommission_date","security_remarks","description"];
const PROTECTED: &[&str]=&["owner","business_owner","technical_owner","monitoring_enabled","pmp_enabled","backup_location","criticality","environment","vm_type","sr_id","last_patch_date","last_vuln_scan_date","last_verified_at","security_remarks"];
const BOOLS: &[&str]=&["monitoring_enabled","ha_enabled","backup_enabled","pmp_enabled"];
const DATES: &[&str]=&["last_patch_date","last_vuln_scan_date","decommission_date","last_verified_at"];
const IP_ROLES: &[(&str,&str)]=&[("private_ip","private"),("public_ip","public"),("backup_ip","backup")];
const SNAPSHOT: &str="SELECT to_jsonb(v) || jsonb_build_object('disks',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.sort_order,d.id) FROM vm_disks d WHERE d.vm_id=v.id),'[]'::jsonb),'networks',COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.sort_order,n.id) FROM vm_networks n WHERE n.vm_id=v.id),'[]'::jsonb),'applications',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.app_name) FROM vm_applications a WHERE a.vm_id=v.id),'[]'::jsonb),'ip_mappings',COALESCE((SELECT jsonb_agg(jsonb_build_object('public_ip',pub.ip_address,'private_ip',priv.ip_address) ORDER BY pub.ip_address ASC,priv.ip_address ASC,m.id ASC) FROM vm_ip_mappings m JOIN vm_networks pub ON pub.id=m.public_ip_id JOIN vm_networks priv ON priv.id=m.private_ip_id WHERE m.vm_id=v.id),'[]'::jsonb)) FROM vms v";
const HEALTH: &str="UPDATE vms v SET health_score=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements_text(v.tags) t WHERE lower(btrim(t))='template') THEN 0 ELSE (CASE WHEN COALESCE(v.description,'')<>'' THEN 10 ELSE 0 END)+(CASE WHEN COALESCE(v.owner,'')<>'' OR COALESCE(v.business_owner,'')<>'' OR COALESCE(v.technical_owner,'')<>'' THEN 15 ELSE 0 END)+(CASE WHEN EXISTS(SELECT 1 FROM vm_applications a WHERE a.vm_id=v.id) THEN 20 ELSE 0 END)+(CASE WHEN EXISTS(SELECT 1 FROM vm_networks n WHERE n.vm_id=v.id) THEN 15 ELSE 0 END)+(CASE WHEN EXISTS(SELECT 1 FROM vm_disks d WHERE d.vm_id=v.id) THEN 15 ELSE 0 END)+(CASE WHEN v.monitoring_enabled THEN 10 ELSE 0 END)+(CASE WHEN v.decommission_date IS NOT NULL THEN 15 ELSE 0 END) END WHERE v.id=$1";

fn text<'a>(value: &'a Value,key: &str) -> &'a str {value[key].as_str().unwrap_or("")}
fn error(field: &str,message: impl Into<String>) -> Value {json!({"field":field,"message":message.into()})}
fn parts(value: &str) -> impl Iterator<Item=&str> {value.split(';').map(str::trim).filter(|s|!s.is_empty())}
fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value,"%Y-%m-%d").or_else(|_|NaiveDate::parse_from_str(value,"%Y%m%d")).or_else(|_|NaiveDate::parse_from_str(value,"%G-W%V-%u")).ok()
}
#[derive(Clone,Debug)]
struct Disk { name:String,size:i64,storage_name:Option<String>,storage_type:Option<String> }
fn disks(raw: &Value,errors: &mut Vec<Value>) -> Vec<Disk> {
    let mut result=Vec::new();
    let mut seen=HashSet::new();
    for part in parts(text(raw,"disks")) {
        let fields:Vec<_>=part.split(':').map(str::trim).collect();
        let size=fields.get(1).filter(|s|!s.is_empty() && s.bytes().all(|c|c.is_ascii_digit())).and_then(|s|s.parse::<i64>().ok());
        if !(2..=4).contains(&fields.len()) || fields[0].is_empty() || size.is_none() {
            errors.push(error("disks","must be name:size[:storage_name[:storage_type]] separated by ;")); return Vec::new();
        }
        if !seen.insert(fields[0].to_lowercase()) {continue;}
        let storage=|index: usize, key: &str| -> Option<String> { fields.get(index).copied().filter(|s: &&str| !s.is_empty()).map(str::to_owned).or_else(||{let s=text(raw,key); if s.is_empty(){None}else{Some(s.to_owned())}}) };
        result.push(Disk{name:fields[0].into(),size:size.unwrap(),storage_name:storage(2,"storage_name"),storage_type:storage(3,"storage_type")});
    }
    result
}
fn applications(raw: &Value,errors: &mut Vec<Value>) -> Vec<(String,Option<String>)> {
    let mut result=Vec::new();let mut seen=HashSet::new();
    for part in parts(text(raw,"applications")) {
        let (name,owner)=part.split_once(':').unwrap_or((part,""));let name=name.trim();let owner=owner.trim();
        if name.is_empty(){errors.push(error("applications","must be name or name:owner entries separated by ;"));return Vec::new();}
        if seen.insert(name.to_lowercase()){result.push((name.into(),if owner.is_empty(){None}else{Some(owner.into())}));}
    }result
}
fn ips(raw: &Value,key: &str,errors: &mut Vec<Value>) -> Vec<String> {
    let mut result=Vec::new();
    for part in parts(text(raw,key)){
        let ip=part.split('/').next().unwrap_or("").trim();
        if ip.is_empty(){continue;}
        if ip.contains(':'){errors.push(error(key,"must be IP addresses separated by ;"));return Vec::new();}
        result.push(ip.into());
    }
    result
}
fn parse_ip_mappings(raw: &Value, errors: &mut Vec<Value>) -> Option<Vec<(String, String)>> {
    let raw_val = raw.get("ip_mappings")?.as_str()?;
    if raw_val.trim().is_empty() { return None; }
    let raw_parts: Vec<_> = parts(raw_val).collect();
    if raw_parts.len() > MAX_CSV_MAPPINGS_PER_ROW {
        errors.push(error("ip_mappings", format!("must have at most {MAX_CSV_MAPPINGS_PER_ROW} mapping pairs")));
        return Some(Vec::new());
    }
    let mut pairs = Vec::new();
    let mut seen = HashSet::new();
    for part in raw_parts {
        let pieces: Vec<_> = part.split('>').collect();
        if pieces.len() != 2 {
            errors.push(error("ip_mappings", "must be public>private pairs separated by ;"));
            return Some(Vec::new());
        }
        let pub_part = pieces[0].trim();
        let priv_part = pieces[1].trim();
        if pub_part.is_empty() || priv_part.is_empty() || pub_part.contains(':') || priv_part.contains(':') {
            errors.push(error("ip_mappings", "must be public>private pairs separated by ;"));
            return Some(Vec::new());
        }
        if pub_part.chars().count() > MAX_ENDPOINT_LENGTH || priv_part.chars().count() > MAX_ENDPOINT_LENGTH {
            errors.push(error("ip_mappings", format!("each endpoint must be at most {MAX_ENDPOINT_LENGTH} characters")));
            return Some(Vec::new());
        }
        let pub_norm = match crate::core::ip_utils::parse_ipv4_endpoint(pub_part) {
            Ok(ip) => ip,
            Err(_) => {
                errors.push(error("ip_mappings", "invalid IPv4 address in mapping pair"));
                return Some(Vec::new());
            }
        };
        let priv_norm = match crate::core::ip_utils::parse_ipv4_endpoint(priv_part) {
            Ok(ip) => ip,
            Err(_) => {
                errors.push(error("ip_mappings", "invalid IPv4 address in mapping pair"));
                return Some(Vec::new());
            }
        };
        if seen.insert((pub_norm.clone(), priv_norm.clone())) {
            pairs.push((pub_norm, priv_norm));
        }
    }
    Some(pairs)
}
fn status_error(normalized:&Value,create:bool)->Option<Value>{
    match normalized.get("status"){
        Some(Value::String(status)) if ["running","powered_off","decommissioned"].contains(&status.as_str())=>None,
        None if !create=>None,
        None=>Some(error("status","is required and cannot be blank")),
        _=>Some(error("status","must be one of running, powered_off, decommissioned")),
    }
}
fn validate_staged_status(rows:&[Value])->Result<(),ApiError>{
    for row in rows{
        let action=text(row,"action");
        if matches!(action,"create"|"update"|"unchanged"){
            if let Some(error)=status_error(&row["normalized"],action=="create"){return Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY,format!("Row {} failed to import: status {}",row["row_number"],text(&error,"message"))));}
        }
    }
    Ok(())
}
fn validate_staged_mappings(rows: &[Value]) -> Result<(), ApiError> {
    let mut total_batch_mappings = 0usize;
    for row in rows {
        let raw_val = text(&row["raw"], "ip_mappings");
        if raw_val.trim().is_empty() {
            continue;
        }
        let raw_parts: Vec<&str> = parts(raw_val).collect();
        if raw_parts.len() > MAX_MAPPINGS_PER_VM {
            return Err(ApiError::new(StatusCode::CONFLICT, "Import preview is stale or invalid: please preview again"));
        }
        total_batch_mappings += raw_parts.len();
        if total_batch_mappings > MAX_CSV_BATCH_MAPPINGS {
            return Err(ApiError::new(StatusCode::CONFLICT, "Import preview is stale or invalid: please preview again"));
        }
        for part in raw_parts {
            let pieces: Vec<&str> = part.split('>').collect();
            if pieces.len() != 2 {
                return Err(ApiError::new(StatusCode::CONFLICT, "Import preview is stale or invalid: please preview again"));
            }
            let pub_part = pieces[0].trim();
            let priv_part = pieces[1].trim();
            if pub_part.is_empty() || priv_part.is_empty() || pub_part.contains(':') || priv_part.contains(':') {
                return Err(ApiError::new(StatusCode::CONFLICT, "Import preview is stale or invalid: please preview again"));
            }
            if pub_part.chars().count() > MAX_ENDPOINT_LENGTH || priv_part.chars().count() > MAX_ENDPOINT_LENGTH {
                return Err(ApiError::new(StatusCode::CONFLICT, "Import preview is stale or invalid: please preview again"));
            }
            if crate::core::ip_utils::parse_ipv4_endpoint(pub_part).is_err() || crate::core::ip_utils::parse_ipv4_endpoint(priv_part).is_err() {
                return Err(ApiError::new(StatusCode::CONFLICT, "Import preview is stale or invalid: please preview again"));
            }
        }
    }
    Ok(())
}
fn normalize(raw: &Value) -> (Option<Value>,Vec<Value>) {
    let mut normalized=Map::new();let mut errors=Vec::new();
    for key in ["name","platform","cluster"] {let value=text(raw,key); if value.is_empty(){errors.push(error(key,"is required and cannot be blank"));}normalized.insert(key.into(),json!(value));}
    let platform=text(raw,"platform").to_lowercase();
    if !platform.is_empty(){let value=match platform.as_str(){"pve"|"proxmox"=>Some("proxmox"),"vmware"|"vcenter"|"vsphere"=>Some("vmware"),_=>None};if let Some(value)=value{normalized.insert("platform".into(),json!(value));}else{errors.push(error("platform","must be one of proxmox, pve, vmware, vsphere, vcenter"));}}
    let enums:[(&str,&[&str]);5]=[("status",&["decommissioned","powered_off","running"]),("environment",&["development","dr","production","sandbox","staging","testing","uat"]),("criticality",&["critical","high","low","medium"]),("os_family",&["linux","windows"]),("vm_type",&["permanent","temporary"])];
    for (key,allowed) in enums {
        let value=text(raw,key).trim().to_lowercase();
        if value.is_empty(){continue;}
        if allowed.contains(&value.as_str()){normalized.insert(key.into(),json!(value));}else{errors.push(error(key,format!("must be one of {}",allowed.join(", "))));}
    }
    for key in ["cpu_cores","memory_mb"]{let value=text(raw,key);if value.is_empty(){continue;}match value.parse::<i64>(){Ok(n) if n>=0=>{normalized.insert(key.into(),json!(n));},_=>errors.push(error(key,"must be an integer >= 0"))}}
    for key in BOOLS{let value=text(raw,key).to_lowercase();if value.is_empty(){continue;}match value.as_str(){"true"|"yes"|"1"=>{normalized.insert((*key).into(),json!(true));},"false"|"no"|"0"=>{normalized.insert((*key).into(),json!(false));},_=>errors.push(error(key,"must be one of true, false, yes, no, 1, 0"))}}
    for key in DATES{
        let value=text(raw,key);
        if value.is_empty(){continue;}
        if let Some(date)=parse_date(value){normalized.insert((*key).into(),json!(date.to_string()));}else{errors.push(error(key,"must be ISO date YYYY-MM-DD"));}
    }
    for key in COLUMNS {if ["name","platform","cluster","status","environment","criticality","os_family","vm_type","cpu_cores","memory_mb","tags","virtual_hosts"].contains(key) || BOOLS.contains(key)||DATES.contains(key){continue;}let value=text(raw,key);if !value.is_empty(){normalized.insert((*key).into(),json!(value));}}
    let vh_raw=if !text(raw,"virtual_hosts").is_empty(){text(raw,"virtual_hosts")}else{text(raw,"fqdn")};
    if !vh_raw.trim().is_empty(){
        let trimmed=vh_raw.trim();
        let json_arr=if trimmed.starts_with('[')&&trimmed.ends_with(']'){serde_json::from_str::<Vec<Value>>(trimmed).ok()}else{None};
        if let Some(arr)=json_arr{
            if arr.len()>VIRTUAL_HOST_MAX_COUNT{errors.push(error("virtual_hosts",format!("must have at most {VIRTUAL_HOST_MAX_COUNT} entries")));}
            else if arr.iter().any(|v|!v.is_string()){errors.push(error("virtual_hosts","every JSON entry must be a string"));}
            else{
                let mut out=Vec::new();let mut seen=HashSet::new();
                for s in arr.iter().filter_map(Value::as_str){let t=s.trim();if !t.is_empty()&&seen.insert(t.to_lowercase()){out.push(t.to_string());}}
                if out.iter().any(|s|s.chars().count()>VIRTUAL_HOST_MAX_LEN){errors.push(error("virtual_hosts",format!("each entry must be at most {VIRTUAL_HOST_MAX_LEN} characters")));}
                else{normalized.insert("virtual_hosts".into(),json!(out));}
            }
        }else{
            let mut out=Vec::new();let mut seen=HashSet::new();
            for part in parts(trimmed){if seen.insert(part.to_lowercase()){out.push(part.to_string());}}
            if out.is_empty(){out.push(trimmed.to_string());}
            if out.len()>VIRTUAL_HOST_MAX_COUNT{errors.push(error("virtual_hosts",format!("must have at most {VIRTUAL_HOST_MAX_COUNT} entries")));}
            else if out.iter().any(|s|s.chars().count()>VIRTUAL_HOST_MAX_LEN){errors.push(error("virtual_hosts",format!("each entry must be at most {VIRTUAL_HOST_MAX_LEN} characters")));}
            else{normalized.insert("virtual_hosts".into(),json!(out));}
        }
    }
    if !text(raw,"tags").is_empty(){normalized.insert("tags".into(),json!(parts(text(raw,"tags")).collect::<Vec<_>>()));}
    disks(raw,&mut errors);applications(raw,&mut errors);for (key,_) in IP_ROLES{ips(raw,key,&mut errors);}parse_ip_mappings(raw,&mut errors);
    if errors.is_empty(){(Some(Value::Object(normalized)),errors)}else{(None,errors)}
}
fn identity(value: &Value) -> String {
    if text(value,"platform")=="proxmox"{json!(["proxmox",value.get("external_id").unwrap_or(&Value::Null),text(value,"name").to_lowercase(),text(value,"cluster").to_lowercase()]).to_string()}
    else{json!(["vmware",text(value,"name").to_lowercase(),text(value,"cluster").to_lowercase()]).to_string()}
}
fn supplied(value: &Value) -> bool {match value {Value::Null=>false,Value::Bool(flag)=>*flag,Value::String(s)=>!s.trim().is_empty(),_=>true}}
fn updates(normalized: &Value,vm: &Value) -> Value {
    Value::Object(normalized.as_object().unwrap().iter().filter(|(key,_)|!PROTECTED.contains(&key.as_str()) || !supplied(&vm[*key])).map(|(key,value)|(key.clone(),value.clone())).collect())
}
#[derive(Clone, Debug)]
struct IpPlan { header:&'static str,role:&'static str,retargets:Vec<(Value,String)>,inserts:Vec<String> }

#[derive(Clone, Debug)]
struct NetworkMappingPlan {
    ip_plans: Vec<IpPlan>,
    new_mapping_pairs: Vec<(String, String)>,
    mapping_errors: Vec<Value>,
}

fn plan_networks_and_mappings(vm: Option<&Value>, raw: &Value) -> NetworkMappingPlan {
    let mut mapping_errors = Vec::new();
    let requested = parse_ip_mappings(raw, &mut mapping_errors);

    let networks = vm.and_then(|v| v.get("networks")).and_then(Value::as_array).cloned().unwrap_or_default();
    let mut claimed: HashSet<String> = networks.iter().map(|n| text(n, "ip_address").into()).collect();

    let mut protected_ips: HashSet<String> = HashSet::new();
    if let Some(existing_mappings) = vm.and_then(|v| v.get("ip_mappings")).and_then(Value::as_array) {
        for m in existing_mappings {
            if let Some(p) = m.get("public_ip").and_then(Value::as_str) {
                protected_ips.insert(crate::core::ip_utils::normalize_ip(p).to_string());
            }
            if let Some(p) = m.get("private_ip").and_then(Value::as_str) {
                protected_ips.insert(crate::core::ip_utils::normalize_ip(p).to_string());
            }
        }
    }
    if let Some(req) = &requested {
        for (pub_ip, priv_ip) in req {
            protected_ips.insert(pub_ip.clone());
            protected_ips.insert(priv_ip.clone());
        }
    }

    let mut ip_plans = Vec::new();
    for &(header, role) in IP_ROLES {
        let mut unique = HashSet::new();
        let mentioned: Vec<_> = ips(raw, header, &mut Vec::new()).into_iter().filter(|s| unique.insert(s.clone())).collect();
        let mut role_rows: Vec<_> = networks.iter().filter(|n| text(n, "role") == role).cloned().collect();
        role_rows.sort_by(|a, b| a["sort_order"].as_i64().cmp(&b["sort_order"].as_i64()).then_with(|| text(a, "id").cmp(text(b, "id"))));
        let existing: HashSet<_> = role_rows.iter().map(|n| crate::core::ip_utils::normalize_ip(text(n, "ip_address")).to_string()).collect();
        let new: Vec<_> = mentioned.iter().filter(|s| !existing.contains(crate::core::ip_utils::normalize_ip(s)) && !claimed.contains(*s)).cloned().collect();
        let reusable: Vec<_> = role_rows.into_iter()
            .filter(|n| {
                let norm = crate::core::ip_utils::normalize_ip(text(n, "ip_address"));
                !mentioned.iter().any(|ip| crate::core::ip_utils::normalize_ip(ip) == norm) && !protected_ips.contains(norm)
            })
            .collect();
        let count = new.len().min(reusable.len());
        let retargets: Vec<(Value, String)> = reusable.into_iter().take(count).zip(new.iter().take(count).cloned()).collect();
        let inserts: Vec<String> = new.iter().skip(count).cloned().collect();
        claimed.extend(new);
        ip_plans.push(IpPlan { header, role, retargets, inserts });
    }

    let mut effective_networks: Vec<(String, String)> = Vec::new();
    if let Some(vm_val) = vm {
        if let Some(nets) = vm_val.get("networks").and_then(Value::as_array) {
            for n in nets {
                let current_ip = text(n, "ip_address");
                let role = text(n, "role");
                let mut retargeted_ip = None;
                for plan in &ip_plans {
                    if let Some((_, new_ip)) = plan.retargets.iter().find(|(orig, _)| orig["id"] == n["id"]) {
                        retargeted_ip = Some(new_ip.clone());
                        break;
                    }
                }
                if let Some(new_ip) = retargeted_ip {
                    effective_networks.push((new_ip, role.to_string()));
                } else {
                    effective_networks.push((current_ip.to_string(), role.to_string()));
                }
            }
        }
    }
    for plan in &ip_plans {
        for insert_ip in &plan.inserts {
            effective_networks.push((insert_ip.clone(), plan.role.to_string()));
        }
    }

    let mut effective_ip_to_networks: HashMap<String, Vec<&str>> = HashMap::new();
    for (ip, role) in &effective_networks {
        let norm = crate::core::ip_utils::normalize_ip(ip).to_string();
        effective_ip_to_networks.entry(norm).or_default().push(role.as_str());
    }

    let mut new_mapping_pairs = Vec::new();
    if let Some(req_pairs) = &requested {
        let existing_pairs: HashSet<(String, String)> = vm
            .and_then(|v| v.get("ip_mappings"))
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter().map(|m| (text(m, "public_ip").to_string(), text(m, "private_ip").to_string())).collect()
            })
            .unwrap_or_default();

        for (pub_raw, priv_raw) in req_pairs {
            let pub_norm = crate::core::ip_utils::normalize_ip(pub_raw).to_string();
            let priv_norm = crate::core::ip_utils::normalize_ip(priv_raw).to_string();

            let pub_roles = effective_ip_to_networks.get(&pub_norm);
            match pub_roles {
                None => {
                    mapping_errors.push(error("ip_mappings", format!("Address '{pub_raw}' does not match any network entry on this VM")));
                }
                Some(roles) => {
                    let matching: Vec<_> = roles.iter().filter(|r| **r == "public").collect();
                    if matching.is_empty() {
                        let actual = roles[0];
                        mapping_errors.push(error("ip_mappings", format!("Network entry '{pub_raw}' has role '{actual}', expected 'public'")));
                    } else if matching.len() > 1 {
                        mapping_errors.push(error("ip_mappings", format!("Ambiguous public address '{pub_raw}'; multiple matching network entries found")));
                    }
                }
            }

            let priv_roles = effective_ip_to_networks.get(&priv_norm);
            match priv_roles {
                None => {
                    mapping_errors.push(error("ip_mappings", format!("Address '{priv_raw}' does not match any network entry on this VM")));
                }
                Some(roles) => {
                    let matching: Vec<_> = roles.iter().filter(|r| **r == "private").collect();
                    if matching.is_empty() {
                        let actual = roles[0];
                        mapping_errors.push(error("ip_mappings", format!("Network entry '{priv_raw}' has role '{actual}', expected 'private'")));
                    } else if matching.len() > 1 {
                        mapping_errors.push(error("ip_mappings", format!("Ambiguous private address '{priv_raw}'; multiple matching network entries found")));
                    }
                }
            }

            if mapping_errors.is_empty() {
                let pair = (pub_norm.to_string(), priv_norm.to_string());
                if !existing_pairs.contains(&pair) {
                    new_mapping_pairs.push(pair);
                }
            }
        }

        let existing_mappings = vm.and_then(|v| v.get("ip_mappings")).and_then(Value::as_array);
        let existing_count = existing_mappings.map(|a| a.len()).unwrap_or(0);
        if !new_mapping_pairs.is_empty() && (existing_count + new_mapping_pairs.len()) > MAX_CSV_MAPPINGS_PER_ROW {
            mapping_errors.push(error("ip_mappings", format!("cannot exceed {MAX_CSV_MAPPINGS_PER_ROW} IP mapping pairs for this VM")));
        }
    }

    if mapping_errors.len() > 50 {
        mapping_errors.truncate(50);
    }

    NetworkMappingPlan {
        ip_plans,
        new_mapping_pairs,
        mapping_errors,
    }
}

#[cfg(test)]
fn ip_plans(vm: &Value, raw: &Value) -> Vec<IpPlan> {
    plan_networks_and_mappings(Some(vm), raw).ip_plans
}

fn diff_with_plan(normalized: &Value, vm: &Value, raw: &Value, plan: &NetworkMappingPlan) -> Value {
    let mut changes=Map::new();
    let existing_disks:HashSet<_>=vm["disks"].as_array().into_iter().flatten().map(|d|text(d,"disk_name").to_lowercase()).collect();
    let added:Vec<_>=disks(raw,&mut Vec::new()).iter().filter(|d|!existing_disks.contains(&d.name.to_lowercase())).map(|d|format!("{}:{}",d.name,d.size)).collect();
    if !added.is_empty(){changes.insert("disks".into(),json!([null,added]));}
    let existing_apps:HashSet<_>=vm["applications"].as_array().into_iter().flatten().map(|a|text(a,"app_name").to_lowercase()).collect();
    let added:Vec<_>=applications(raw,&mut Vec::new()).into_iter().filter(|(name,_)|!existing_apps.contains(&name.to_lowercase())).map(|(name,_)|name).collect();
    if !added.is_empty(){changes.insert("applications".into(),json!([null,added]));}
    for p in &plan.ip_plans {
        let old:Vec<_>=p.retargets.iter().map(|(n,_)|text(n,"ip_address")).collect();
        let new:Vec<_>=p.retargets.iter().map(|(_,ip)|ip.clone()).chain(p.inserts.clone()).collect();
        if !new.is_empty(){changes.insert(p.header.into(),json!([if old.is_empty(){Value::Null}else{json!(old)},new]));}
    }
    if !plan.new_mapping_pairs.is_empty() {
        let added_pairs: Vec<String> = plan.new_mapping_pairs.iter().map(|(pub_ip, priv_ip)| format!("{pub_ip}>{priv_ip}")).collect();
        let old_pairs: Vec<String> = vm.get("ip_mappings").and_then(Value::as_array).map(|arr| {
            arr.iter().map(|m| format!("{}>{}", text(m, "public_ip"), text(m, "private_ip"))).collect()
        }).unwrap_or_default();
        let old_val = if old_pairs.is_empty() { Value::Null } else { json!(old_pairs) };
        changes.insert("ip_mappings".into(), json!([old_val, added_pairs]));
    }
    for (key,new) in updates(normalized,vm).as_object().unwrap(){let old=&vm[key];if old!=new{changes.insert(key.clone(),json!([old,new]));}}
    Value::Object(changes)
}

#[cfg(test)]
fn diff(normalized: &Value,vm: &Value,raw: &Value) -> Value {
    let plan = plan_networks_and_mappings(Some(vm), raw);
    diff_with_plan(normalized, vm, raw, &plan)
}
fn parse_csv(content: &[u8]) -> Result<(Vec<Value>,Vec<String>),ApiError> {
    if content.len()>5*1024*1024{return Err(ApiError::bad_request("CSV file exceeds 5 MiB"));}
    let text=std::str::from_utf8(content).map_err(|_|ApiError::bad_request("CSV must be UTF-8 encoded"))?.trim_start_matches('\u{feff}');
    if text.is_empty(){return Err(ApiError::bad_request("CSV file is empty"));}
    let mut reader=csv::ReaderBuilder::new().flexible(true).from_reader(text.as_bytes());
    let headers=reader.headers().map_err(|e|ApiError::bad_request(e.to_string()))?.iter().map(|s|s.trim().to_owned()).collect::<Vec<_>>();
    let mut missing=["name","platform","cluster"].into_iter().filter(|key|!headers.iter().any(|header|header==key)).collect::<Vec<_>>();missing.sort_unstable();
    if !missing.is_empty(){return Err(ApiError::bad_request(format!("CSV missing required headers: {}",missing.join(", "))));}
    let mut ignored=headers.iter().filter(|s|!s.is_empty() && !TEMPLATE.contains(&s.as_str()) && *s != "fqdn").cloned().collect::<Vec<_>>();ignored.sort();ignored.dedup();
    let mut rows=Vec::new();
    for record in reader.records(){let record=record.map_err(|e|ApiError::bad_request(e.to_string()))?;if rows.len()>=5000{return Err(ApiError::bad_request("CSV row count exceeds 5000"));}let raw=headers.iter().enumerate().map(|(i,h)|(h.clone(),json!(record.get(i).unwrap_or("").trim()))).collect::<Map<_,_>>();rows.push(Value::Object(raw));}
    if rows.is_empty(){return Err(ApiError::bad_request("CSV file is empty"));}
    Ok((rows,ignored))
}
async fn snapshot(connection: &mut PgConnection,id: Uuid) -> Result<Value,ApiError> {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!("{SNAPSHOT} WHERE v.id=$1"))).bind(id).fetch_optional(connection).await.map_err(db_error)?.ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Import target VM changed"))
}
async fn load(connection: &mut PgConnection,id: Uuid,user: Uuid,admin: bool) -> Result<Value,ApiError> {
    let mut batch:Value=sqlx::query_scalar("SELECT to_jsonb(b) FROM csv_import_batches b WHERE id=$1").bind(id).fetch_optional(&mut *connection).await.map_err(db_error)?.ok_or_else(||ApiError::not_found("Import batch not found"))?;
    if !admin && text(&batch,"created_by_id")!=user.to_string(){return Err(ApiError::forbidden("Import batch not visible"));}
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(r)-'batch_id' FROM csv_import_rows r WHERE batch_id=$1 ORDER BY row_number").bind(id).fetch_all(connection).await.map_err(db_error)?;
    batch["rows"]=json!(rows);Ok(batch)
}
pub async fn get_batch(State(state):State<AppState>,user:Viewer,Path(id):Path<Uuid>) -> Result<Json<Value>,ApiError> {
    let mut connection=state.pool.acquire().await.map_err(db_error)?;
    Ok(Json(load(&mut connection,id,user.0.id,user.0.role.rank()==3).await?))
}
pub async fn preview(State(state):State<AppState>,user:Editor,_:Csrf,mut multipart:Multipart) -> Result<(StatusCode,Json<Value>),ApiError> {
    let mut filename="upload.csv".to_owned();let mut bytes=None;let mut full_inventory=false;
    while let Some(mut field)=multipart.next_field().await.map_err(|e|ApiError::bad_request(e.to_string()))? {
        match field.name(){Some("full_inventory")=>{let flag=field.text().await.map_err(|e|ApiError::bad_request(e.to_string()))?;match flag.to_lowercase().as_str(){"true"|"1"|"yes"|"on"|"t"|"y"=>full_inventory=true,"false"|"0"|"no"|"off"|"f"|"n"=>full_inventory=false,_=>return Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY,"full_inventory must be a boolean"))}},Some("file")=>{
            if !matches!(field.content_type(),Some("text/csv"|"application/csv"|"application/vnd.ms-excel")){return Err(ApiError::bad_request("CSV upload must use text/csv content type"));}
            filename=field.file_name().filter(|s|!s.is_empty()).unwrap_or("upload.csv").into();let mut content=Vec::new();
            while let Some(chunk)=field.chunk().await.map_err(|e|ApiError::bad_request(e.to_string()))?{if content.len()+chunk.len()>5*1024*1024{return Err(ApiError::bad_request("CSV file exceeds 5 MiB"));}content.extend_from_slice(&chunk);}bytes=Some(content);
        },_=>{}}
    }
    let (raw_rows,ignored)=parse_csv(&bytes.ok_or_else(||ApiError::new(StatusCode::UNPROCESSABLE_ENTITY,"file is required"))?)?;
    let mut total_batch_mappings = 0;
    for raw in &raw_rows {
        if let Some(val) = raw.get("ip_mappings").and_then(Value::as_str) {
            if !val.trim().is_empty() {
                total_batch_mappings += parts(val).count();
            }
        }
    }
    if total_batch_mappings > MAX_CSV_BATCH_MAPPINGS {
        return Err(ApiError::bad_request(format!("CSV import batch exceeds limit of {MAX_CSV_BATCH_MAPPINGS} IP mapping pairs")));
    }
    let id=Uuid::new_v4();let mut tx=state.pool.begin().await.map_err(db_error)?;
    let inventory:Vec<Value>=sqlx::query_scalar(SNAPSHOT).fetch_all(&mut *tx).await.map_err(db_error)?;
    let mut matches:HashMap<String,&Value>=HashMap::new();
    for vm in &inventory { matches.entry(identity(vm)).or_insert(vm); }
    let known_storage:HashSet<String>=sqlx::query_scalar::<_,String>("SELECT lower(name) FROM storage_arrays").fetch_all(&mut *tx).await.map_err(db_error)?.into_iter().collect();
    sqlx::query("INSERT INTO csv_import_batches(id,filename,created_by_id,status,summary,ignored_columns,field_changes,full_inventory,created_at) VALUES($1,$2,$3,'previewed','{}'::jsonb,$4,'{}'::jsonb,$5,now())")
        .bind(id).bind(filename).bind(user.0.id).bind(json!(ignored)).bind(full_inventory).execute(&mut *tx).await.map_err(db_error)?;
    let mut summary=json!({"create":0,"update":0,"unchanged":0,"conflict":0,"invalid":0,"decommission":0});let mut field_changes=Map::new();
    let mut seen=HashSet::new();let mut matched=HashSet::new();let mut scopes=HashSet::new();
    for (index,raw) in raw_rows.iter().enumerate(){
        let (normalized,mut errors)=normalize(raw);let mut action="invalid";let mut target=None;let mut changes=json!({});let mut warnings=Vec::new();
        if let Some(normalized)=&normalized {
            let mut warned=HashSet::new();
            for disk in disks(raw,&mut Vec::new()){if let Some(storage)=disk.storage_name {if warned.insert(storage.to_lowercase())&&!known_storage.contains(&storage.to_lowercase()){warnings.push(error("storage_name",format!("no storage array named '{storage}' exists")));}}}
            let key=identity(normalized);
            if !seen.insert(key.clone()){action="conflict";errors=vec![error("identity","duplicate CSV identity")];}
            else{scopes.insert((text(normalized,"cluster").trim().to_lowercase(),text(normalized,"platform").to_owned()));
                if let Some(vm)=matches.get(&key){
                    let vm_id=Uuid::parse_str(text(vm,"id")).map_err(|e|ApiError::internal(e.to_string()))?;
                    target=Some(vm_id);
                    matched.insert(vm_id);
                    let plan=plan_networks_and_mappings(Some(vm),raw);
                    if !plan.mapping_errors.is_empty(){errors.extend(plan.mapping_errors);action="invalid";}
                    else{
                        changes=diff_with_plan(normalized,vm,raw,&plan);
                        action=if changes.as_object().unwrap().is_empty(){"unchanged"}else{"update"};
                        for field in changes.as_object().unwrap().keys(){let count=field_changes.get(field).and_then(Value::as_i64).unwrap_or(0);field_changes.insert(field.clone(),json!(count+1));}
                    }
                }
                else if let Some(error)=status_error(normalized,true){errors.push(error);}
                else{
                    let plan=plan_networks_and_mappings(None,raw);
                    if !plan.mapping_errors.is_empty(){errors.extend(plan.mapping_errors);action="invalid";}
                    else{
                        action="create";
                        if !plan.new_mapping_pairs.is_empty(){
                            let pairs:Vec<String>=plan.new_mapping_pairs.iter().map(|(pub_ip,priv_ip)|format!("{pub_ip}>{priv_ip}")).collect();
                            changes.as_object_mut().unwrap().insert("ip_mappings".into(),json!([Value::Null,pairs]));
                        }
                    }
                }
            }
        }
        if !errors.is_empty(){action="invalid";}
        summary[action]=json!(summary[action].as_i64().unwrap()+1);
        let errors_val = json!(errors);
        let warnings_val = json!(warnings);
        insert_row(&mut tx, ImportRow {
            batch: id,
            number: index as i32 + 2,
            raw,
            normalized: normalized.as_ref(),
            action,
            target,
            errors: &errors_val,
            warnings: &warnings_val,
            changes: &changes,
        }).await?;
    }
    if full_inventory {
        let mut candidates:Vec<_>=inventory.iter().filter(|vm|text(vm,"status")!="decommissioned" && Uuid::parse_str(text(vm,"id")).is_ok_and(|id|!matched.contains(&id)) && scopes.contains(&(text(vm,"cluster").trim().to_lowercase(),text(vm,"platform").to_owned()))).collect();
        candidates.sort_by(|a,b|text(a,"name").cmp(text(b,"name")));
        for (offset,vm) in candidates.iter().enumerate(){
            let raw=json!({"name":vm["name"],"cluster":vm["cluster"],"platform":vm["platform"]});
            let empty=json!([]);
            let status_changes=json!({"status":[vm["status"],"decommissioned"]});
            insert_row(&mut tx, ImportRow {
                batch: id,
                number: (raw_rows.len()+offset+2) as i32,
                raw: &raw,
                normalized: None,
                action: "decommission",
                target: Some(Uuid::parse_str(text(vm,"id")).unwrap()),
                errors: &empty,
                warnings: &empty,
                changes: &status_changes,
            }).await?;
        }
        summary["decommission"]=json!(candidates.len());summary["decommission_candidate_total"]=json!(candidates.len()+matched.len());
    }
    sqlx::query("UPDATE csv_import_batches SET summary=$2,field_changes=$3 WHERE id=$1").bind(id).bind(summary).bind(Value::Object(field_changes)).execute(&mut *tx).await.map_err(db_error)?;
    let batch=load(&mut tx,id,user.0.id,true).await?;
    tx.commit().await.map_err(db_error)?;
    Ok((StatusCode::CREATED,Json(batch)))
}
struct ImportRow<'a> {
    batch: Uuid,
    number: i32,
    raw: &'a Value,
    normalized: Option<&'a Value>,
    action: &'a str,
    target: Option<Uuid>,
    errors: &'a Value,
    warnings: &'a Value,
    changes: &'a Value,
}

async fn insert_row(connection:&mut PgConnection,row:ImportRow<'_>)->Result<(),ApiError>{
    sqlx::query("INSERT INTO csv_import_rows(id,batch_id,row_number,raw,normalized,action,target_vm_id,errors,warnings,changes,created_at) VALUES($1,$2,$3,$4,$5,$6::import_action,$7,$8,$9,$10,now())")
        .bind(Uuid::new_v4()).bind(row.batch).bind(row.number).bind(row.raw).bind(row.normalized).bind(row.action).bind(row.target).bind(row.errors).bind(row.warnings).bind(row.changes).execute(connection).await.map_err(db_error)?;Ok(())
}

fn python_value(value:&Value,in_list:bool)->Option<String>{match value{Value::Null=>None,Value::String(s)=>Some(if in_list{format!("'{}'",s.replace('\\',"\\\\").replace('\'',"\\'"))}else{s.clone()}),Value::Bool(b)=>Some(if *b{"True".into()}else{"False".into()}),Value::Array(items)=>Some(format!("[{}]",items.iter().map(|item|python_value(item,true).unwrap_or_else(||"None".into())).collect::<Vec<_>>().join(", "))),_=>Some(value.to_string())}}
async fn audit(connection:&mut PgConnection,vm:Uuid,user:Uuid,field:&str,old:&Value,new:&Value)->Result<(),ApiError>{
    sqlx::query("INSERT INTO audit_log(id,vm_id,user_id,field_name,old_value,new_value,changed_at) VALUES($1,$2,$3,$4,$5,$6,now())").bind(Uuid::new_v4()).bind(vm).bind(user).bind(field).bind(python_value(old,false)).bind(python_value(new,false)).execute(connection).await.map_err(db_error)?;Ok(())
}
fn mutation_error(error:sqlx::Error)->ApiError{if error.as_database_error().is_some_and(|e|e.is_unique_violation()){ApiError::new(StatusCode::CONFLICT,"VM identity already exists")}else{db_error(error)}}
async fn write_vm(connection:&mut PgConnection,vm:Option<&Value>,normalized:&Value,user:Uuid)->Result<Uuid,ApiError>{
    if normalized.get("sr_id").and_then(Value::as_str).is_some_and(|s|s.chars().count()>50){return Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY,"sr_id must have at most 50 characters"));}
    if let Some(vm)=vm{
        let id=Uuid::parse_str(text(vm,"id")).map_err(|e|ApiError::internal(e.to_string()))?;
        let values=updates(normalized,vm);
        let fields:Vec<_>=values.as_object().unwrap().keys().filter(|key|COLUMNS.contains(&key.as_str())).collect();
        for key in &fields{if vm[*key]!=values[*key]{audit(connection,id,user,key,&vm[*key],&values[*key]).await?;}}
        let mut assignments=fields.iter().map(|key|format!("{key}=(jsonb_populate_record(NULL::vms,$1)).{key}")).collect::<Vec<_>>();assignments.push("updated_by_id=$2".into());assignments.push("updated_at=now()".into());
        sqlx::query(sqlx::AssertSqlSafe(format!("UPDATE vms SET {} WHERE id=$3",assignments.join(",")))).bind(values).bind(user).bind(id).execute(connection).await.map_err(mutation_error)?;
        Ok(id)
    }else{
        let id=Uuid::new_v4();let mut values=json!({"environment":"production","cpu_cores":0,"memory_mb":0,"criticality":"medium","vm_type":"permanent","monitoring_enabled":false,"ha_enabled":false,"backup_enabled":false,"pmp_enabled":false,"tags":[],"virtual_hosts":[],"os_family":null});
        values.as_object_mut().unwrap().extend(normalized.as_object().unwrap().clone());
        let columns=COLUMNS.join(",");let selected=COLUMNS.iter().map(|key|format!("r.{key}")).collect::<Vec<_>>().join(",");
        sqlx::query(sqlx::AssertSqlSafe(format!("INSERT INTO vms(id,{columns},created_by_id,updated_by_id,created_at,updated_at,health_score) SELECT $2,{selected},$3,$3,now(),now(),0 FROM jsonb_populate_record(NULL::vms,$1) r")))
            .bind(values).bind(id).bind(user).execute(connection).await.map_err(mutation_error)?;
        Ok(id)
    }
}
async fn attach_children(connection:&mut PgConnection,id:Uuid,raw:&Value,user:Uuid)->Result<(),ApiError>{
    let vm=snapshot(connection,id).await?;
    let mut existing:HashSet<_>=vm["disks"].as_array().into_iter().flatten().map(|d|text(d,"disk_name").to_lowercase()).collect();
    let mut order=vm["disks"].as_array().map(Vec::len).unwrap_or(0) as i32;
    for disk in disks(raw,&mut Vec::new()){if !existing.insert(disk.name.to_lowercase()){continue;}
        let size=i32::try_from(disk.size).map_err(|_|ApiError::new(StatusCode::UNPROCESSABLE_ENTITY,"disk size is outside the database integer range"))?;
        sqlx::query("INSERT INTO vm_disks(id,vm_id,disk_name,size_gb,storage_name,storage_type,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(Uuid::new_v4()).bind(id).bind(disk.name).bind(size).bind(disk.storage_name).bind(disk.storage_type).bind(order).execute(&mut *connection).await.map_err(db_error)?;order+=1;
    }
    let mut order=vm["networks"].as_array().map(Vec::len).unwrap_or(0) as i32;
    let plan=plan_networks_and_mappings(Some(&vm),raw);
    for p in plan.ip_plans{for (network,address) in p.retargets{
        let net_id=Uuid::parse_str(text(&network,"id")).map_err(|e|ApiError::internal(e.to_string()))?;
        sqlx::query("UPDATE vm_networks SET ip_address=$2 WHERE id=$1").bind(net_id).bind(&address).execute(&mut *connection).await.map_err(db_error)?;
        audit(connection,id,user,p.header,&network["ip_address"],&json!(address)).await?;
    }for address in p.inserts{
        sqlx::query("INSERT INTO vm_networks(id,vm_id,ip_address,role,sort_order) VALUES($1,$2,$3,$4::network_role,$5)").bind(Uuid::new_v4()).bind(id).bind(address).bind(p.role).bind(order).execute(&mut *connection).await.map_err(db_error)?;order+=1;
    }}
    let before_pairs = crate::api::inventory::service::fetch_vm_mapping_pairs(connection, id).await?;
    let mut mapping_errors=Vec::new();
    if let Some(pairs)=parse_ip_mappings(raw,&mut mapping_errors){
        if !mapping_errors.is_empty() {
            return Err(ApiError::conflict("Invalid IP mappings in CSV row"));
        }
        if !pairs.is_empty() {
            let networks: Vec<(Uuid, String, String)> = sqlx::query_as(
                "SELECT id, ip_address, role::text FROM vm_networks WHERE vm_id = $1"
            )
            .bind(id)
            .fetch_all(&mut *connection)
            .await
            .map_err(db_error)?;

            let mut ip_to_networks: HashMap<String, Vec<(&str, Uuid)>> = HashMap::new();
            for (nid, nip, nrole) in &networks {
                let norm = crate::core::ip_utils::normalize_ip(nip).to_string();
                ip_to_networks.entry(norm).or_default().push((nrole.as_str(), *nid));
            }

            let mut resolved_pairs = Vec::new();
            let mut seen = HashSet::new();
            for (pub_ip, priv_ip) in pairs {
                let pub_norm = crate::core::ip_utils::normalize_ip(&pub_ip).to_string();
                let priv_norm = crate::core::ip_utils::normalize_ip(&priv_ip).to_string();

                let pub_id = match ip_to_networks.get(&pub_norm) {
                    None => return Err(ApiError::conflict(format!("Mapping endpoint '{pub_ip}' does not match any network entry on this VM"))),
                    Some(entries) => {
                        let matching: Vec<_> = entries.iter().filter(|(role, _)| *role == "public").collect();
                        if matching.is_empty() {
                            return Err(ApiError::conflict(format!("Network entry '{pub_ip}' has role '{}', expected 'public'", entries[0].0)));
                        } else if matching.len() > 1 {
                            return Err(ApiError::conflict(format!("Ambiguous public address '{pub_ip}'; multiple matching network entries found")));
                        }
                        matching[0].1
                    }
                };
                let priv_id = match ip_to_networks.get(&priv_norm) {
                    None => return Err(ApiError::conflict(format!("Mapping endpoint '{priv_ip}' does not match any network entry on this VM"))),
                    Some(entries) => {
                        let matching: Vec<_> = entries.iter().filter(|(role, _)| *role == "private").collect();
                        if matching.is_empty() {
                            return Err(ApiError::conflict(format!("Network entry '{priv_ip}' has role '{}', expected 'private'", entries[0].0)));
                        } else if matching.len() > 1 {
                            return Err(ApiError::conflict(format!("Ambiguous private address '{priv_ip}'; multiple matching network entries found")));
                        }
                        matching[0].1
                    }
                };

                if seen.insert((pub_id, priv_id)) {
                    resolved_pairs.push((pub_id, priv_id));
                }
            }

            if !resolved_pairs.is_empty() {
                let mut builder = sqlx::QueryBuilder::new(
                    "INSERT INTO vm_ip_mappings(id,vm_id,public_ip_id,public_role,private_ip_id,private_role) "
                );
                builder.push_values(resolved_pairs, |mut b, (pub_id, priv_id)| {
                    b.push_bind(Uuid::new_v4())
                     .push_bind(id)
                     .push_bind(pub_id)
                     .push(" 'public' ")
                     .push_bind(priv_id)
                     .push(" 'private' ");
                });
                builder.push(" ON CONFLICT (public_ip_id,private_ip_id) DO NOTHING");
                builder.build().execute(&mut *connection).await.map_err(db_error)?;
            }
        }
    }
    let after_pairs = crate::api::inventory::service::fetch_vm_mapping_pairs(connection, id).await?;
    crate::api::inventory::service::audit_ip_mappings(connection, id, user, &before_pairs, &after_pairs).await?;
    let mut existing:HashSet<_>=vm["applications"].as_array().into_iter().flatten().map(|a|text(a,"app_name").to_lowercase()).collect();
    for (name,owner) in applications(raw,&mut Vec::new()){if existing.insert(name.to_lowercase()){
        sqlx::query("INSERT INTO vm_applications(id,vm_id,app_name,app_owner) VALUES($1,$2,$3,$4)").bind(Uuid::new_v4()).bind(id).bind(name).bind(owner).execute(&mut *connection).await.map_err(db_error)?;
    }}Ok(())
}
#[derive(Deserialize,Default)]
pub struct CommitRequest{#[serde(default)]confirm_decommission:bool}
pub async fn commit(State(state):State<AppState>,user:Editor,_:Csrf,Path(id):Path<Uuid>,payload:Option<Json<CommitRequest>>)->Result<Json<Value>,ApiError>{
    let mut tx=state.pool.begin().await.map_err(db_error)?;
    sqlx::query("SELECT id FROM csv_import_batches WHERE id=$1 FOR UPDATE").bind(id).fetch_optional(&mut *tx).await.map_err(db_error)?;
    let batch=load(&mut tx,id,user.0.id,user.0.role.rank()==3).await?;
    if text(&batch,"status")!="previewed"{return Err(ApiError::new(StatusCode::CONFLICT,"Import batch is not previewed"));}
    let rows=batch["rows"].as_array().unwrap();
    if rows.iter().any(|row|matches!(text(row,"action"),"invalid"|"conflict")){return Err(ApiError::new(StatusCode::CONFLICT,"Import contains invalid or conflicting rows"));}
    validate_staged_status(rows)?;
    validate_staged_mappings(rows)?;
    let decommission=rows.iter().filter(|row|text(row,"action")=="decommission").count();
    let total=batch["summary"]["decommission_candidate_total"].as_u64().unwrap_or(0) as usize;
    if decommission>0 && total>0 && decommission*2>total && !payload.as_ref().is_some_and(|p|p.confirm_decommission){return Err(ApiError::new(StatusCode::CONFLICT,format!("This import would decommission {decommission} of {total} VMs (over half the inventory). Re-submit with confirm_decommission to proceed.")));}
    let mut target_ids: Vec<Uuid> = rows.iter().filter_map(|row| {
        row["target_vm_id"].as_str().and_then(|s| Uuid::parse_str(s).ok())
    }).collect();
    target_ids.sort();
    target_ids.dedup();
    for target_id in target_ids {
        if let Err(e) = crate::api::inventory::service::lock_vm(&mut tx, target_id).await {
            if e.status == StatusCode::NOT_FOUND {
                return Err(ApiError::new(StatusCode::CONFLICT, "Import target VM changed"));
            }
            return Err(e);
        }
    }
    let mut result=json!({"created":0,"updated":0,"decommissioned":0});
    for row in rows {
        let action=text(row,"action");
        if action=="unchanged"{
            if !text(&row["raw"],"ip_mappings").trim().is_empty(){
                let target_id=row["target_vm_id"].as_str().and_then(|s|Uuid::parse_str(s).ok()).ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Import target VM changed"))?;
                sqlx::query("SELECT id FROM vms WHERE id=$1 FOR UPDATE").bind(target_id).fetch_optional(&mut *tx).await.map_err(db_error)?;
                let vm=snapshot(&mut tx,target_id).await?;
                let plan=plan_networks_and_mappings(Some(&vm),&row["raw"]);
                if !plan.mapping_errors.is_empty()||!plan.new_mapping_pairs.is_empty()||plan.ip_plans.iter().any(|p|!p.retargets.is_empty()||!p.inserts.is_empty()){
                    return Err(ApiError::new(StatusCode::CONFLICT,"Import preview is stale: network configuration changed"));
                }
            }
            continue;
        }
        let outcome=commit_row(&mut tx,row,user.0.id).await;
        let vm=match outcome {Ok(id)=>id,Err(error) if matches!(error.status,StatusCode::CONFLICT|StatusCode::FORBIDDEN|StatusCode::NOT_FOUND)=>return Err(error),Err(error)=>return Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY,format!("Row {} failed to import: {}",row["row_number"],error.message)))};
        sqlx::query(HEALTH).bind(vm).execute(&mut *tx).await.map_err(db_error)?;
        let key=match action{"create"=>"created","decommission"=>"decommissioned",_=>"updated"};result[key]=json!(result[key].as_i64().unwrap()+1);
    }
    sqlx::query("UPDATE csv_import_batches SET status='committed',committed_at=now(),summary=summary||'{\"committed\":true}'::jsonb WHERE id=$1").bind(id).execute(&mut *tx).await.map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;Ok(Json(result))
}
async fn commit_row(connection:&mut PgConnection,row:&Value,user:Uuid)->Result<Uuid,ApiError>{
    let action=text(row,"action");
    let target=row["target_vm_id"].as_str().and_then(|s|Uuid::parse_str(s).ok());
    if action=="create"{
        let plan = plan_networks_and_mappings(None, &row["raw"]);
        if !plan.mapping_errors.is_empty() {
            return Err(ApiError::new(StatusCode::CONFLICT, "Import preview is stale: network mappings changed"));
        }
        let id=write_vm(connection,None,&row["normalized"],user).await?;
        attach_children(connection,id,&row["raw"],user).await?;
        return Ok(id);
    }
    let id=target.ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Import target VM changed"))?;
    sqlx::query("SELECT id FROM vms WHERE id=$1 FOR UPDATE").bind(id).fetch_optional(&mut *connection).await.map_err(db_error)?;
    let vm=snapshot(connection,id).await?;
    if action=="decommission"{
        let mut normalized=json!({"status":"decommissioned"});if vm["decommission_date"].is_null(){normalized["decommission_date"]=json!(chrono::Local::now().date_naive().to_string());}
        return write_vm(connection,Some(&vm),&normalized,user).await;
    }
    if identity(&vm)!=identity(&row["normalized"]){return Err(ApiError::new(StatusCode::CONFLICT,"Import target VM changed"));}

    let plan=plan_networks_and_mappings(Some(&vm),&row["raw"]);
    if !plan.mapping_errors.is_empty(){return Err(ApiError::new(StatusCode::CONFLICT,"Import preview is stale: network mappings changed"));}
    let previewed_changes=&row["changes"];
    for p in &plan.ip_plans{
        let old:Vec<String>=p.retargets.iter().map(|(n,_)|text(n,"ip_address").to_string()).collect();
        let new:Vec<String>=p.retargets.iter().map(|(_,ip)|ip.clone()).chain(p.inserts.clone()).collect();
        let previewed=previewed_changes.get(p.header);
        if new.is_empty(){
            if previewed.is_some(){return Err(ApiError::new(StatusCode::CONFLICT,"Import preview is stale: network changes changed"));}
        }else{
            let expected_old=if old.is_empty(){Value::Null}else{json!(old)};
            let expected=json!([expected_old,new]);
            if previewed!=Some(&expected){return Err(ApiError::new(StatusCode::CONFLICT,"Import preview is stale: network changes changed"));}
        }
    }
    let previewed_mappings=previewed_changes.get("ip_mappings");
    if plan.new_mapping_pairs.is_empty(){
        if previewed_mappings.is_some(){return Err(ApiError::new(StatusCode::CONFLICT,"Import preview is stale: network mappings changed"));}
    }else{
        let added:Vec<String>=plan.new_mapping_pairs.iter().map(|(pub_ip,priv_ip)|format!("{pub_ip}>{priv_ip}")).collect();
        let previewed_added=previewed_mappings.and_then(|v|v.as_array()).and_then(|arr|arr.get(1));
        if previewed_added!=Some(&json!(added)){return Err(ApiError::new(StatusCode::CONFLICT,"Import preview is stale: network mappings changed"));}
    }

    write_vm(connection,Some(&vm),&row["normalized"],user).await?;attach_children(connection,id,&row["raw"],user).await?;Ok(id)
}
pub async fn template(_:Viewer)->Result<Response,ApiError>{
    let rows=[
        ["SAMPLE-web-01","VM-1001","[\"web-01.corp.local\",\"portal.corp.local\"]","SR-2481","proxmox","DC-Mumbai","pve-cluster-01","pve-node-03","running","production","high","permanent","4","8192","os:100;data:500","SAMPLE-SAN-01","ssd","linux","ubuntu","22.04","10.20.30.41","198.51.100.10","","198.51.100.10>10.20.30.41","infra-team","Retail Ops","A. Sharma","nginx:web-team;postgres:dba-team","true","true","true","true","Veeam-Repo-01","web;tier1","2026-07-14","2026-07-01","2026-07-20","","","Sample row - delete before importing"],
        ["SAMPLE-test-02","VM-1002","[\"test-02.corp.local\"]","SR-2492","vmware","DC-Pune","vc-cluster-02","esxi-node-11","powered_off","testing","low","temporary","2","4096","os:60","","","windows","","2022","10.20.31.52","","","","qa-team","QA","R. Iyer","iis","false","false","false","false","","sandbox","2026-06-02","","","2026-09-30","","Sample row - delete before importing"],
    ];
    let mut writer=csv::WriterBuilder::new().terminator(csv::Terminator::Any(b'\n')).from_writer(Vec::new());
    writer.write_record(TEMPLATE).map_err(|e|ApiError::internal(e.to_string()))?;
    for row in rows{writer.write_record(row).map_err(|e|ApiError::internal(e.to_string()))?;}
    let bytes=writer.into_inner().map_err(|e|ApiError::internal(e.to_string()))?;
    Ok(([(header::CONTENT_TYPE,"text/csv"),(header::CONTENT_DISPOSITION,"attachment; filename=\"vm-import-template.csv\"")],bytes).into_response())
}
#[cfg(test)]
mod tests{
    use super::*;
    #[tokio::test]
    async fn csv_template_round_trips_multiple_virtual_hosts(){
        let now=chrono::Utc::now();
        let viewer=crate::api::deps::RequireRole::<1>(crate::models::user::User{
            id:Uuid::nil(),email:"viewer@example.test".into(),password_hash:String::new(),
            role:crate::models::user::UserRole::Viewer,is_active:true,auth_source:"local".into(),
            preferences:json!({}),created_at:now,updated_at:now,
        });
        let response=template(viewer).await.unwrap();
        assert_eq!(response.headers()[header::CONTENT_TYPE],"text/csv");
        assert_eq!(response.headers()[header::CONTENT_DISPOSITION],"attachment; filename=\"vm-import-template.csv\"");
        let bytes=axum::body::to_bytes(response.into_body(),1024*1024).await.unwrap();
        let (rows,ignored)=parse_csv(&bytes).unwrap();
        assert!(ignored.is_empty());
        assert_eq!(rows.len(),2);
        for row in &rows{
            let (normalized,errors)=normalize(row);
            assert!(errors.is_empty(),"{errors:?}");
            let normalized=normalized.unwrap();
            assert!(status_error(&normalized,true).is_none());
            assert!(normalized["virtual_hosts"].is_array());
            assert!(normalized.get("fqdn").is_none());
        }
        let (normalized,_)=normalize(&rows[0]);
        assert_eq!(normalized.unwrap()["virtual_hosts"],json!(["web-01.corp.local","portal.corp.local"]));
    }
    #[test]
    fn csv_virtual_hosts_updates_replace_clear_or_preserve(){
        let vm=json!({"virtual_hosts":["old.corp.local"]});
        for (cell,expected) in [("new.corp.local;portal.corp.local",Some(json!(["new.corp.local","portal.corp.local"]))),("[]",Some(json!([]))),("",None)]{
            let (normalized,errors)=normalize(&json!({"name":"one","platform":"pve","cluster":"c","virtual_hosts":cell}));
            assert!(errors.is_empty());
            let values=updates(&normalized.unwrap(),&vm);
            assert_eq!(values.get("virtual_hosts"),expected.as_ref());
        }
    }
    #[test] fn csv_status_accepts_three_values_rejects_unknown(){
        for status in ["running","powered_off","decommissioned"]{let (normalized,errors)=normalize(&json!({"name":"one","platform":"vmware","cluster":"c","status":status}));assert!(errors.is_empty());let normalized=normalized.unwrap();assert_eq!(normalized["status"],status);assert!(status_error(&normalized,true).is_none());}
        for status in ["unknown"," UNKNOWN ","null"]{let (normalized,errors)=normalize(&json!({"name":"one","platform":"vmware","cluster":"c","status":status}));assert!(normalized.is_none());assert_eq!(errors[0]["field"],"status");}
        assert!(status_error(&json!({"status":null}),false).is_some());
    }
    #[test] fn missing_new_status_is_invalid_blank_existing_update_omits_status(){
        for status in [None,Some(""),Some("   ")]{
            let mut raw=json!({"name":"one","platform":"vmware","cluster":"c","owner":"new"});if let Some(status)=status{raw["status"]=json!(status);}
            let (normalized,errors)=normalize(&raw);assert!(errors.is_empty());let normalized=normalized.unwrap();
            assert_eq!(status_error(&normalized,true).unwrap()["field"],"status");assert!(status_error(&normalized,false).is_none());
            for status in ["running","unknown"]{let vm=json!({"status":status,"owner":null});let values=updates(&normalized,&vm);assert!(values.get("status").is_none());assert_eq!(values["owner"],"new");}
        }
    }
    #[test] fn old_preview_status_is_revalidated_before_any_writes(){
        let valid=json!({"row_number":2,"action":"create","normalized":{"status":"running"}});
        for action in ["create","update","unchanged"]{
            for status in [json!("unknown"),Value::Null,json!("invalid")]{
                let stale=json!({"row_number":3,"action":action,"normalized":{"status":status}});
                let e=validate_staged_status(&[valid.clone(),stale]).unwrap_err();assert_eq!(e.status,StatusCode::UNPROCESSABLE_ENTITY);assert!(e.message.contains("Row 3"));
            }
        }
        assert!(validate_staged_status(&[valid.clone(),json!({"row_number":3,"action":"create","normalized":{}})]).is_err());
        assert!(validate_staged_status(&[valid,json!({"action":"update","normalized":{}}),json!({"action":"unchanged","normalized":{}}),json!({"action":"decommission","normalized":null})]).is_ok());
    }
    #[test] fn supplied_blanks_do_not_override(){let raw=json!({"name":"one","platform":"PVE","cluster":"c","monitoring_enabled":"","business_owner":""});let (normalized,errors)=normalize(&raw);assert!(errors.is_empty());let normalized=normalized.unwrap();assert_eq!(normalized["platform"],"proxmox");assert!(normalized.get("monitoring_enabled").is_none());assert!(normalized.get("business_owner").is_none());}
    #[test] fn protected_values_gap_fill_only(){let normalized=json!({"name":"new","business_owner":"csv","monitoring_enabled":true,"environment":"testing"});let vm=json!({"name":"old","business_owner":"curated","monitoring_enabled":false,"environment":"production"});let values=updates(&normalized,&vm);assert!(values.get("business_owner").is_none());assert!(values.get("environment").is_none());assert_eq!(values["monitoring_enabled"],true);assert_eq!(values["name"],"new");}
    #[test] fn ip_retarget_preserves_extra_addresses_and_role_precedence(){let vm=json!({"networks":[{"id":"1","role":"private","ip_address":"10.0.0.1","sort_order":0},{"id":"2","role":"private","ip_address":"10.0.0.2","sort_order":1}]});let raw=json!({"private_ip":"10.0.0.3/24;10.0.0.3","public_ip":"10.0.0.3;10.0.0.4"});let plans=ip_plans(&vm,&raw);assert_eq!(plans[0].retargets.len(),1);assert_eq!(plans[0].retargets[0].1,"10.0.0.3");assert_eq!(plans[1].inserts,vec!["10.0.0.4"]);}
    #[test] fn invalid_child_cells_block_normalization(){let (normalized,errors)=normalize(&json!({"name":"one","platform":"vmware","cluster":"c","disks":"os:-1","private_ip":"2001:db8::1","applications":":owner"}));assert!(normalized.is_none());assert_eq!(errors.len(),3);}
    #[test] fn storage_fallback_and_case_insensitive_dedup(){let disks=disks(&json!({"disks":"os:10;OS:20;data:50:san:ssd","storage_name":"default","storage_type":"hdd"}),&mut Vec::new());assert_eq!(disks.len(),2);assert_eq!(disks[0].storage_name.as_deref(),Some("default"));assert_eq!(disks[1].storage_type.as_deref(),Some("ssd"));}
    #[test] fn csv_bom_unknown_headers_and_missing_cells(){let (rows,ignored)=parse_csv("\u{feff}name,platform,cluster,extra\na,pve,c\n".as_bytes()).unwrap();assert_eq!(ignored,vec!["extra"]);assert_eq!(rows[0]["extra"],"");assert!(parse_csv(b"name,platform\na,pve\n").is_err());}
    #[test] fn csv_virtual_hosts_and_legacy_fqdn_normalization(){
        let (n1, e1) = normalize(&json!({"name":"one","platform":"pve","cluster":"c","virtual_hosts":"[\"alpha.local\",\"beta, with comma\",\"alpha.local\"]"}));
        assert!(e1.is_empty());
        assert_eq!(n1.unwrap()["virtual_hosts"], json!(["alpha.local", "beta, with comma"]));

        let (n2, e2) = normalize(&json!({"name":"two","platform":"vmware","cluster":"c","fqdn":"legacy.corp.local"}));
        assert!(e2.is_empty());
        assert_eq!(n2.unwrap()["virtual_hosts"], json!(["legacy.corp.local"]));

        let (rows, ignored) = parse_csv(b"name,platform,cluster,fqdn\na,pve,c,host.local\n").unwrap();
        assert!(ignored.is_empty());
        assert_eq!(rows[0]["fqdn"], "host.local");
    }
    #[test] fn csv_virtual_host_bounds_reject_instead_of_truncating(){
        let ok="x".repeat(VIRTUAL_HOST_MAX_LEN);let long="x".repeat(VIRTUAL_HOST_MAX_LEN+1);
        let (n, e) = normalize(&json!({"name":"a","platform":"pve","cluster":"c","virtual_hosts":format!("[\"{ok}\"]")}));
        assert!(e.is_empty());assert_eq!(n.unwrap()["virtual_hosts"], json!([ok]));
        let (n, e) = normalize(&json!({"name":"b","platform":"pve","cluster":"c","virtual_hosts":format!("[\"{long}\"]")}));
        assert!(n.is_none());assert_eq!(e[0]["field"], "virtual_hosts");
        let many: Vec<String> = (0..=VIRTUAL_HOST_MAX_COUNT).map(|i| format!("h{i}.local")).collect();
        let (n, e) = normalize(&json!({"name":"c","platform":"pve","cluster":"c","virtual_hosts":serde_json::to_string(&many).unwrap()}));
        assert!(n.is_none());assert_eq!(e[0]["field"], "virtual_hosts");
        let (n, e) = normalize(&json!({"name":"d","platform":"pve","cluster":"c","virtual_hosts":"Shop, EU;portal.local"}));
        assert!(e.is_empty());assert_eq!(n.unwrap()["virtual_hosts"], json!(["Shop, EU", "portal.local"]));
    }
    #[test] fn csv_virtual_hosts_explicit_empty_clears_and_nonstring_rejects(){
        let (n, e) = normalize(&json!({"name":"e","platform":"pve","cluster":"c","virtual_hosts":"[]"}));
        assert!(e.is_empty());assert_eq!(n.unwrap()["virtual_hosts"], json!([]));
        let (n, e) = normalize(&json!({"name":"f","platform":"pve","cluster":"c","virtual_hosts":"[\"ok.local\",42]"}));
        assert!(n.is_none());assert_eq!(e[0]["field"], "virtual_hosts");
        let (n, e) = normalize(&json!({"name":"g","platform":"pve","cluster":"c","virtual_hosts":"  "}));
        assert!(e.is_empty());assert!(n.unwrap().get("virtual_hosts").is_none());
    }
    #[test]
    fn csv_ip_mappings_syntax_errors_reject_normalization(){
        for bad in ["foo", "1.1.1.1", "1.1.1.1>", ">1.1.1.1", "1.1.1.1>2.2.2.2>3.3.3.3", "1.1.1.1:80>2.2.2.2", "2001:db8::1>10.0.0.1"] {
            let (n, e) = normalize(&json!({"name":"a","platform":"pve","cluster":"c","ip_mappings":bad}));
            assert!(n.is_none(), "expected error for {bad}");
            assert_eq!(e[0]["field"], "ip_mappings");
            assert_eq!(e[0]["message"], "must be public>private pairs separated by ;");
        }
        let (n, e) = normalize(&json!({"name":"a","platform":"pve","cluster":"c","ip_mappings":" 203.0.113.4 > 10.0.0.5 ; 203.0.113.4 > 10.0.0.6 "}));
        assert!(e.is_empty());
        assert!(n.is_some());
    }
    #[test]
    fn csv_ip_mappings_protects_existing_mapped_and_referenced_addresses_from_retargeting(){
        // VM has public IP 203.0.113.1 (mapped to 10.0.0.1), private 10.0.0.1 (mapped), private 10.0.0.2 (unlinked).
        let vm = json!({
            "networks": [
                {"id": "n1", "role": "public", "ip_address": "203.0.113.1", "sort_order": 0},
                {"id": "n2", "role": "private", "ip_address": "10.0.0.1", "sort_order": 0},
                {"id": "n3", "role": "private", "ip_address": "10.0.0.2", "sort_order": 1}
            ],
            "ip_mappings": [
                {"public_ip": "203.0.113.1", "private_ip": "10.0.0.1"}
            ]
        });
        // Raw introduces new private IP 10.0.0.99.
        // n2 (10.0.0.1) is protected because it is in ip_mappings.
        // n3 (10.0.0.2) is unlinked, so it should be retargeted to 10.0.0.99.
        let raw = json!({"private_ip": "10.0.0.99"});
        let plan = plan_networks_and_mappings(Some(&vm), &raw);
        let priv_plan = plan.ip_plans.iter().find(|p| p.role == "private").unwrap();
        assert_eq!(priv_plan.retargets.len(), 1);
        assert_eq!(text(&priv_plan.retargets[0].0, "id"), "n3");
        assert_eq!(priv_plan.retargets[0].1, "10.0.0.99");
        assert!(priv_plan.inserts.is_empty());

        // Now if 10.0.0.2 is referenced in raw's ip_mappings, it too must be protected from retargeting!
        let raw_with_ref = json!({
            "private_ip": "10.0.0.99",
            "ip_mappings": "203.0.113.1>10.0.0.2"
        });
        let plan_ref = plan_networks_and_mappings(Some(&vm), &raw_with_ref);
        let priv_plan_ref = plan_ref.ip_plans.iter().find(|p| p.role == "private").unwrap();
        // Since both n2 and n3 are protected, neither can be retargeted, so 10.0.0.99 must be inserted!
        assert!(priv_plan_ref.retargets.is_empty());
        assert_eq!(priv_plan_ref.inserts, vec!["10.0.0.99"]);
    }
    #[test]
    fn csv_ip_mappings_diff_shows_mapping_additions_and_omits_unchanged(){
        let vm = json!({
            "name": "vm1",
            "networks": [
                {"id": "n1", "role": "public", "ip_address": "203.0.113.1", "sort_order": 0},
                {"id": "n2", "role": "private", "ip_address": "10.0.0.1", "sort_order": 0},
                {"id": "n3", "role": "private", "ip_address": "10.0.0.2", "sort_order": 1}
            ],
            "ip_mappings": [
                {"public_ip": "203.0.113.1", "private_ip": "10.0.0.1"}
            ]
        });
        let normalized = json!({"name": "vm1"});

        // 1. Row adds a new mapping 203.0.113.1>10.0.0.2
        let raw_add = json!({"name": "vm1", "ip_mappings": "203.0.113.1>10.0.0.2"});
        let changes_add = diff(&normalized, &vm, &raw_add);
        let map_changes = changes_add.as_object().unwrap().get("ip_mappings").unwrap();
        assert_eq!(map_changes[0], json!(["203.0.113.1>10.0.0.1"]));
        assert_eq!(map_changes[1], json!(["203.0.113.1>10.0.0.2"]));

        // 2. Row repeats existing mapping 203.0.113.1>10.0.0.1 (idempotent / unchanged)
        let raw_same = json!({"name": "vm1", "ip_mappings": "203.0.113.1>10.0.0.1"});
        let changes_same = diff(&normalized, &vm, &raw_same);
        assert!(changes_same.as_object().unwrap().get("ip_mappings").is_none());
        assert!(changes_same.as_object().unwrap().is_empty());

        // 3. Row omits ip_mappings: preserves existing, produces no ip_mappings change
        let raw_blank = json!({"name": "vm1"});
        let changes_blank = diff(&normalized, &vm, &raw_blank);
        assert!(changes_blank.as_object().unwrap().get("ip_mappings").is_none());
        assert!(changes_blank.as_object().unwrap().is_empty());
    }
    #[test]
    fn csv_ip_mappings_effective_network_role_and_unresolved_errors(){
        let vm = json!({
            "networks": [
                {"id": "n1", "role": "public", "ip_address": "203.0.113.1", "sort_order": 0},
                {"id": "n2", "role": "private", "ip_address": "10.0.0.1", "sort_order": 0},
                {"id": "n3", "role": "private", "ip_address": "10.0.0.2", "sort_order": 1},
                {"id": "n4", "role": "private", "ip_address": "10.0.0.2", "sort_order": 2}
            ],
            "ip_mappings": []
        });

        // Unresolved public address
        let raw_unres = json!({"ip_mappings": "198.51.100.99>10.0.0.1"});
        let plan = plan_networks_and_mappings(Some(&vm), &raw_unres);
        assert_eq!(plan.mapping_errors.len(), 1);
        assert!(plan.mapping_errors[0]["message"].as_str().unwrap().contains("does not match any network entry"));

        // Wrong role (using private IP as public)
        let raw_wrong = json!({"ip_mappings": "10.0.0.1>10.0.0.1"});
        let plan = plan_networks_and_mappings(Some(&vm), &raw_wrong);
        assert_eq!(plan.mapping_errors.len(), 1);
        assert!(plan.mapping_errors[0]["message"].as_str().unwrap().contains("has role 'private', expected 'public'"));

        // Ambiguous address (two network rows with 10.0.0.2 with role private)
        let raw_amb = json!({"ip_mappings": "203.0.113.1>10.0.0.2"});
        let plan = plan_networks_and_mappings(Some(&vm), &raw_amb);
        assert_eq!(plan.mapping_errors.len(), 1);
        assert!(plan.mapping_errors[0]["message"].as_str().unwrap().contains("Ambiguous private address '10.0.0.2'"));
    }
    #[test]
    fn csv_ip_mappings_bounds_and_growth_limits(){
        let mut errors = Vec::new();

        let over_256 = (0..257).map(|i| format!("203.0.113.{i}>10.0.0.{i}")).collect::<Vec<_>>().join(";");
        let parsed = parse_ip_mappings(&json!({"ip_mappings": over_256}), &mut errors);
        assert!(parsed.is_some());
        assert_eq!(errors.len(), 1);
        assert!(errors[0]["message"].as_str().unwrap().contains("must have at most 256 mapping pairs"));

        let mut err2 = Vec::new();
        let long_endpoint = format!("{}>10.0.0.1", "1".repeat(51));
        parse_ip_mappings(&json!({"ip_mappings": long_endpoint}), &mut err2);
        assert_eq!(err2.len(), 1);
        assert!(err2[0]["message"].as_str().unwrap().contains("at most 50 characters"));

        let existing_250: Vec<Value> = (0..250).map(|i| json!({"public_ip": format!("203.0.113.{i}"), "private_ip": format!("10.0.0.{i}")})).collect();
        let vm = json!({
            "networks": [
                {"id": "n1", "role": "public", "ip_address": "203.0.113.1", "sort_order": 0},
                {"id": "n2", "role": "private", "ip_address": "10.0.0.1", "sort_order": 0},
                {"id": "n3", "role": "private", "ip_address": "10.0.0.2", "sort_order": 1}
            ],
            "ip_mappings": existing_250
        });

        let plan_blank = plan_networks_and_mappings(Some(&vm), &json!({}));
        assert!(plan_blank.mapping_errors.is_empty());
        assert!(plan_blank.new_mapping_pairs.is_empty());

        let plan_idempotent = plan_networks_and_mappings(Some(&vm), &json!({"ip_mappings": "203.0.113.1>10.0.0.1"}));
        assert!(plan_idempotent.mapping_errors.is_empty());
        assert!(plan_idempotent.new_mapping_pairs.is_empty());

        let add_10 = (0..10).map(|i| format!("203.0.114.{i}>10.0.0.1")).collect::<Vec<_>>().join(";");
        let mut networks = vec![
            json!({"id": "n1", "role": "private", "ip_address": "10.0.0.1", "sort_order": 0}),
        ];
        for i in 0..10 {
            networks.push(json!({"id": format!("pub_{i}"), "role": "public", "ip_address": format!("203.0.114.{i}"), "sort_order": 0}));
        }
        let vm_many = json!({
            "networks": networks,
            "ip_mappings": (0..250).map(|i| json!({"public_ip": format!("203.0.113.{i}"), "private_ip": "10.0.0.1"})).collect::<Vec<_>>()
        });
        let plan_over = plan_networks_and_mappings(Some(&vm_many), &json!({"ip_mappings": add_10}));
        assert_eq!(plan_over.mapping_errors.len(), 1);
        assert!(plan_over.mapping_errors[0]["message"].as_str().unwrap().contains("cannot exceed 256 IP mapping pairs for this VM"));
    }
}
