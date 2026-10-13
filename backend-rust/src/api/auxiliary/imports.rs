use axum::{extract::{Multipart, Path, State}, http::{header,StatusCode}, response::{IntoResponse,Response}, Json};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::PgConnection;
use std::collections::{HashMap,HashSet};
use uuid::Uuid;
use crate::api::deps::{ApiError,AppState,Viewer,Editor,Csrf};
use super::db_error;

const COLUMNS: &[&str]=&["name","external_id","fqdn","sr_id","platform","datacenter","cluster","node","status","environment","criticality","vm_type","cpu_cores","memory_mb","os_family","os_distribution","os_version","owner","business_owner","technical_owner","monitoring_enabled","pmp_enabled","ha_enabled","backup_enabled","backup_location","tags","last_patch_date","last_vuln_scan_date","last_verified_at","decommission_date","security_remarks","description"];
const TEMPLATE: &[&str]=&["name","external_id","fqdn","sr_id","platform","datacenter","cluster","node","status","environment","criticality","vm_type","cpu_cores","memory_mb","disks","storage_name","storage_type","os_family","os_distribution","os_version","private_ip","public_ip","backup_ip","owner","business_owner","technical_owner","applications","monitoring_enabled","pmp_enabled","ha_enabled","backup_enabled","backup_location","tags","last_patch_date","last_vuln_scan_date","last_verified_at","decommission_date","security_remarks","description"];
const PROTECTED: &[&str]=&["owner","business_owner","technical_owner","monitoring_enabled","pmp_enabled","backup_location","criticality","environment","vm_type","sr_id","last_patch_date","last_vuln_scan_date","last_verified_at","security_remarks"];
const BOOLS: &[&str]=&["monitoring_enabled","ha_enabled","backup_enabled","pmp_enabled"];
const DATES: &[&str]=&["last_patch_date","last_vuln_scan_date","decommission_date","last_verified_at"];
const IP_ROLES: &[(&str,&str)]=&[("private_ip","private"),("public_ip","public"),("backup_ip","backup")];
const SNAPSHOT: &str="SELECT to_jsonb(v) || jsonb_build_object('disks',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.sort_order,d.id) FROM vm_disks d WHERE d.vm_id=v.id),'[]'::jsonb),'networks',COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.sort_order,n.id) FROM vm_networks n WHERE n.vm_id=v.id),'[]'::jsonb),'applications',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.app_name) FROM vm_applications a WHERE a.vm_id=v.id),'[]'::jsonb)) FROM vms v";
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
    for part in parts(text(raw,key)){let ip=part.split('/').next().unwrap_or("").trim();if ip.is_empty(){continue;}if ip.contains(':'){errors.push(error(key,"must be IP addresses separated by ;"));return Vec::new();}result.push(ip.into());}
    result
}
fn normalize(raw: &Value) -> (Option<Value>,Vec<Value>) {
    let mut normalized=Map::new();let mut errors=Vec::new();
    for key in ["name","platform","cluster"] {let value=text(raw,key); if value.is_empty(){errors.push(error(key,"is required and cannot be blank"));}normalized.insert(key.into(),json!(value));}
    let platform=text(raw,"platform").to_lowercase();
    if !platform.is_empty(){let value=match platform.as_str(){"pve"|"proxmox"=>Some("proxmox"),"vmware"|"vcenter"|"vsphere"=>Some("vmware"),_=>None};if let Some(value)=value{normalized.insert("platform".into(),json!(value));}else{errors.push(error("platform","must be one of proxmox, pve, vmware, vsphere, vcenter"));}}
    let enums:[(&str,&[&str]);5]=[("status",&["decommissioned","powered_off","running","unknown"]),("environment",&["development","dr","production","sandbox","staging","testing","uat"]),("criticality",&["critical","high","low","medium"]),("os_family",&["linux","windows"]),("vm_type",&["permanent","temporary"])];
    for (key,allowed) in enums {let value=text(raw,key).to_lowercase();if value.is_empty(){continue;}if allowed.contains(&value.as_str()){normalized.insert(key.into(),json!(value));}else{errors.push(error(key,format!("must be one of {}",allowed.join(", "))));}}
    for key in ["cpu_cores","memory_mb"]{let value=text(raw,key);if value.is_empty(){continue;}match value.parse::<i64>(){Ok(n) if n>=0=>{normalized.insert(key.into(),json!(n));},_=>errors.push(error(key,"must be an integer >= 0"))}}
    for key in BOOLS{let value=text(raw,key).to_lowercase();if value.is_empty(){continue;}match value.as_str(){"true"|"yes"|"1"=>{normalized.insert((*key).into(),json!(true));},"false"|"no"|"0"=>{normalized.insert((*key).into(),json!(false));},_=>errors.push(error(key,"must be one of true, false, yes, no, 1, 0"))}}
    for key in DATES{let value=text(raw,key);if value.is_empty(){continue;}if let Some(date)=parse_date(value){normalized.insert((*key).into(),json!(date.to_string()));}else{errors.push(error(key,"must be ISO date YYYY-MM-DD"));}}
    for key in COLUMNS {if ["name","platform","cluster","status","environment","criticality","os_family","vm_type","cpu_cores","memory_mb","tags"].contains(key) || BOOLS.contains(key)||DATES.contains(key){continue;}let value=text(raw,key);if !value.is_empty(){normalized.insert((*key).into(),json!(value));}}
    if !text(raw,"tags").is_empty(){normalized.insert("tags".into(),json!(parts(text(raw,"tags")).collect::<Vec<_>>()));}
    disks(raw,&mut errors);applications(raw,&mut errors);for (key,_) in IP_ROLES{ips(raw,key,&mut errors);}
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
#[derive(Debug)]
struct IpPlan { header:&'static str,role:&'static str,retargets:Vec<(Value,String)>,inserts:Vec<String> }
fn ip_plans(vm: &Value,raw: &Value) -> Vec<IpPlan> {
    let networks=vm["networks"].as_array().cloned().unwrap_or_default();
    let mut claimed:HashSet<String>=networks.iter().map(|n|text(n,"ip_address").into()).collect();
    let mut plans=Vec::new();
    for &(header,role) in IP_ROLES {
        let mut unique=HashSet::new();
        let mentioned:Vec<_>=ips(raw,header,&mut Vec::new()).into_iter().filter(|s|unique.insert(s.clone())).collect();
        let mut role_rows:Vec<_>=networks.iter().filter(|n|text(n,"role")==role).cloned().collect();
        role_rows.sort_by(|a,b|a["sort_order"].as_i64().cmp(&b["sort_order"].as_i64()).then_with(||text(a,"id").cmp(text(b,"id"))));
        let existing:HashSet<_>=role_rows.iter().map(|n|text(n,"ip_address").to_owned()).collect();
        let new:Vec<_>=mentioned.iter().filter(|s|!existing.contains(*s)&&!claimed.contains(*s)).cloned().collect();
        let reusable:Vec<_>=role_rows.into_iter().filter(|n|!mentioned.iter().any(|ip|ip==text(n,"ip_address"))).collect();
        let count=new.len().min(reusable.len());
        let retargets=reusable.into_iter().take(count).zip(new.iter().take(count).cloned()).collect();
        let inserts=new.iter().skip(count).cloned().collect();
        claimed.extend(new);
        plans.push(IpPlan{header,role,retargets,inserts});
    }plans
}
fn diff(normalized: &Value,vm: &Value,raw: &Value) -> Value {
    let mut changes=Map::new();
    let existing_disks:HashSet<_>=vm["disks"].as_array().into_iter().flatten().map(|d|text(d,"disk_name").to_lowercase()).collect();
    let added:Vec<_>=disks(raw,&mut Vec::new()).iter().filter(|d|!existing_disks.contains(&d.name.to_lowercase())).map(|d|format!("{}:{}",d.name,d.size)).collect();
    if !added.is_empty(){changes.insert("disks".into(),json!([null,added]));}
    let existing_apps:HashSet<_>=vm["applications"].as_array().into_iter().flatten().map(|a|text(a,"app_name").to_lowercase()).collect();
    let added:Vec<_>=applications(raw,&mut Vec::new()).into_iter().filter(|(name,_)|!existing_apps.contains(&name.to_lowercase())).map(|(name,_)|name).collect();
    if !added.is_empty(){changes.insert("applications".into(),json!([null,added]));}
    for plan in ip_plans(vm,raw){let old:Vec<_>=plan.retargets.iter().map(|(n,_)|text(n,"ip_address")).collect();let new:Vec<_>=plan.retargets.iter().map(|(_,ip)|ip.clone()).chain(plan.inserts).collect();if !new.is_empty(){changes.insert(plan.header.into(),json!([if old.is_empty(){Value::Null}else{json!(old)},new]));}}
    for (key,new) in updates(normalized,vm).as_object().unwrap(){let old=&vm[key];if old!=new{changes.insert(key.clone(),json!([old,new]));}}
    Value::Object(changes)
}
fn parse_csv(content: &[u8]) -> Result<(Vec<Value>,Vec<String>),ApiError> {
    if content.len()>5*1024*1024{return Err(ApiError::bad_request("CSV file exceeds 5 MiB"));}
    let text=std::str::from_utf8(content).map_err(|_|ApiError::bad_request("CSV must be UTF-8 encoded"))?.trim_start_matches('\u{feff}');
    if text.is_empty(){return Err(ApiError::bad_request("CSV file is empty"));}
    let mut reader=csv::ReaderBuilder::new().flexible(true).from_reader(text.as_bytes());
    let headers=reader.headers().map_err(|e|ApiError::bad_request(e.to_string()))?.iter().map(|s|s.trim().to_owned()).collect::<Vec<_>>();
    let mut missing=["name","platform","cluster"].into_iter().filter(|key|!headers.iter().any(|header|header==key)).collect::<Vec<_>>();missing.sort_unstable();
    if !missing.is_empty(){return Err(ApiError::bad_request(format!("CSV missing required headers: {}",missing.join(", "))));}
    let mut ignored=headers.iter().filter(|s|!s.is_empty() && !TEMPLATE.contains(&s.as_str())).cloned().collect::<Vec<_>>();ignored.sort();ignored.dedup();
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
                if let Some(vm)=matches.get(&key){let vm_id=Uuid::parse_str(text(vm,"id")).map_err(|e|ApiError::internal(e.to_string()))?;target=Some(vm_id);matched.insert(vm_id);changes=diff(normalized,vm,raw);action=if changes.as_object().unwrap().is_empty(){"unchanged"}else{"update"};for field in changes.as_object().unwrap().keys(){let count=field_changes.get(field).and_then(Value::as_i64).unwrap_or(0);field_changes.insert(field.clone(),json!(count+1));}}
                else{action="create";}
            }
        }
        summary[action]=json!(summary[action].as_i64().unwrap()+1);
        insert_row(&mut tx,id,index as i32+2,raw,normalized.as_ref(),action,target,&json!(errors),&json!(warnings),&changes).await?;
    }
    if full_inventory {
        let mut candidates:Vec<_>=inventory.iter().filter(|vm|text(vm,"status")!="decommissioned" && Uuid::parse_str(text(vm,"id")).is_ok_and(|id|!matched.contains(&id)) && scopes.contains(&(text(vm,"cluster").trim().to_lowercase(),text(vm,"platform").to_owned()))).collect();
        candidates.sort_by(|a,b|text(a,"name").cmp(text(b,"name")));
        for (offset,vm) in candidates.iter().enumerate(){let raw=json!({"name":vm["name"],"cluster":vm["cluster"],"platform":vm["platform"]});insert_row(&mut tx,id,(raw_rows.len()+offset+2) as i32,&raw,None,"decommission",Some(Uuid::parse_str(text(vm,"id")).unwrap()),&json!([]),&json!([]),&json!({"status":[vm["status"],"decommissioned"]})).await?;}
        summary["decommission"]=json!(candidates.len());summary["decommission_candidate_total"]=json!(candidates.len()+matched.len());
    }
    sqlx::query("UPDATE csv_import_batches SET summary=$2,field_changes=$3 WHERE id=$1").bind(id).bind(summary).bind(Value::Object(field_changes)).execute(&mut *tx).await.map_err(db_error)?;
    let batch=load(&mut tx,id,user.0.id,true).await?;
    tx.commit().await.map_err(db_error)?;
    Ok((StatusCode::CREATED,Json(batch)))
}
async fn insert_row(connection:&mut PgConnection,batch:Uuid,number:i32,raw:&Value,normalized:Option<&Value>,action:&str,target:Option<Uuid>,errors:&Value,warnings:&Value,changes:&Value)->Result<(),ApiError>{
    sqlx::query("INSERT INTO csv_import_rows(id,batch_id,row_number,raw,normalized,action,target_vm_id,errors,warnings,changes,created_at) VALUES($1,$2,$3,$4,$5,$6::import_action,$7,$8,$9,$10,now())")
        .bind(Uuid::new_v4()).bind(batch).bind(number).bind(raw).bind(normalized).bind(action).bind(target).bind(errors).bind(warnings).bind(changes).execute(connection).await.map_err(db_error)?;Ok(())
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
        let id=Uuid::new_v4();let mut values=json!({"status":"unknown","environment":"production","cpu_cores":0,"memory_mb":0,"criticality":"medium","vm_type":"permanent","monitoring_enabled":false,"ha_enabled":false,"backup_enabled":false,"pmp_enabled":false,"tags":[],"os_family":null});
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
    for plan in ip_plans(&vm,raw){for (network,address) in plan.retargets{
        let net_id=Uuid::parse_str(text(&network,"id")).map_err(|e|ApiError::internal(e.to_string()))?;
        sqlx::query("UPDATE vm_networks SET ip_address=$2 WHERE id=$1").bind(net_id).bind(&address).execute(&mut *connection).await.map_err(db_error)?;
        audit(connection,id,user,plan.header,&network["ip_address"],&json!(address)).await?;
    }for address in plan.inserts{
        sqlx::query("INSERT INTO vm_networks(id,vm_id,ip_address,role,sort_order) VALUES($1,$2,$3,$4::network_role,$5)").bind(Uuid::new_v4()).bind(id).bind(address).bind(plan.role).bind(order).execute(&mut *connection).await.map_err(db_error)?;order+=1;
    }}
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
    let decommission=rows.iter().filter(|row|text(row,"action")=="decommission").count();
    let total=batch["summary"]["decommission_candidate_total"].as_u64().unwrap_or(0) as usize;
    if decommission>0 && total>0 && decommission*2>total && !payload.as_ref().is_some_and(|p|p.confirm_decommission){return Err(ApiError::new(StatusCode::CONFLICT,format!("This import would decommission {decommission} of {total} VMs (over half the inventory). Re-submit with confirm_decommission to proceed.")));}
    let mut result=json!({"created":0,"updated":0,"decommissioned":0});
    for row in rows {
        let action=text(row,"action");if action=="unchanged"{continue;}
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
    if action=="create"{let id=write_vm(connection,None,&row["normalized"],user).await?;attach_children(connection,id,&row["raw"],user).await?;return Ok(id);}
    let id=target.ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Import target VM changed"))?;
    sqlx::query("SELECT id FROM vms WHERE id=$1 FOR UPDATE").bind(id).fetch_optional(&mut *connection).await.map_err(db_error)?;
    let vm=snapshot(connection,id).await?;
    if action=="decommission"{
        let mut normalized=json!({"status":"decommissioned"});if vm["decommission_date"].is_null(){normalized["decommission_date"]=json!(chrono::Local::now().date_naive().to_string());}
        return write_vm(connection,Some(&vm),&normalized,user).await;
    }
    if identity(&vm)!=identity(&row["normalized"]){return Err(ApiError::new(StatusCode::CONFLICT,"Import target VM changed"));}
    write_vm(connection,Some(&vm),&row["normalized"],user).await?;attach_children(connection,id,&row["raw"],user).await?;Ok(id)
}
pub async fn template(_:Viewer)->Result<Response,ApiError>{
    let rows=[
        ["SAMPLE-web-01","VM-1001","web-01.corp.local","SR-2481","proxmox","DC-Mumbai","pve-cluster-01","pve-node-03","running","production","high","permanent","4","8192","os:100;data:500","SAMPLE-SAN-01","ssd","linux","ubuntu","22.04","10.20.30.41","","","infra-team","Retail Ops","A. Sharma","nginx:web-team;postgres:dba-team","true","true","true","true","Veeam-Repo-01","web;tier1","2026-07-14","2026-07-01","2026-07-20","","","Sample row - delete before importing"],
        ["SAMPLE-test-02","VM-1002","test-02.corp.local","SR-2492","vmware","DC-Pune","vc-cluster-02","esxi-node-11","powered_off","testing","low","temporary","2","4096","os:60","","","windows","","2022","10.20.31.52","","","qa-team","QA","R. Iyer","iis","false","false","false","false","","sandbox","2026-06-02","","","2026-09-30","","Sample row - delete before importing"],
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
    #[test] fn supplied_blanks_do_not_override(){let raw=json!({"name":"one","platform":"PVE","cluster":"c","monitoring_enabled":"","business_owner":""});let (normalized,errors)=normalize(&raw);assert!(errors.is_empty());let normalized=normalized.unwrap();assert_eq!(normalized["platform"],"proxmox");assert!(normalized.get("monitoring_enabled").is_none());assert!(normalized.get("business_owner").is_none());}
    #[test] fn protected_values_gap_fill_only(){let normalized=json!({"name":"new","business_owner":"csv","monitoring_enabled":true,"environment":"testing"});let vm=json!({"name":"old","business_owner":"curated","monitoring_enabled":false,"environment":"production"});let values=updates(&normalized,&vm);assert!(values.get("business_owner").is_none());assert!(values.get("environment").is_none());assert_eq!(values["monitoring_enabled"],true);assert_eq!(values["name"],"new");}
    #[test] fn ip_retarget_preserves_extra_addresses_and_role_precedence(){let vm=json!({"networks":[{"id":"1","role":"private","ip_address":"10.0.0.1","sort_order":0},{"id":"2","role":"private","ip_address":"10.0.0.2","sort_order":1}]});let raw=json!({"private_ip":"10.0.0.3/24;10.0.0.3","public_ip":"10.0.0.3;10.0.0.4"});let plans=ip_plans(&vm,&raw);assert_eq!(plans[0].retargets.len(),1);assert_eq!(plans[0].retargets[0].1,"10.0.0.3");assert_eq!(plans[1].inserts,vec!["10.0.0.4"]);}
    #[test] fn invalid_child_cells_block_normalization(){let (normalized,errors)=normalize(&json!({"name":"one","platform":"vmware","cluster":"c","disks":"os:-1","private_ip":"2001:db8::1","applications":":owner"}));assert!(normalized.is_none());assert_eq!(errors.len(),3);}
    #[test] fn storage_fallback_and_case_insensitive_dedup(){let disks=disks(&json!({"disks":"os:10;OS:20;data:50:san:ssd","storage_name":"default","storage_type":"hdd"}),&mut Vec::new());assert_eq!(disks.len(),2);assert_eq!(disks[0].storage_name.as_deref(),Some("default"));assert_eq!(disks[1].storage_type.as_deref(),Some("ssd"));}
    #[test] fn csv_bom_unknown_headers_and_missing_cells(){let (rows,ignored)=parse_csv("\u{feff}name,platform,cluster,extra\na,pve,c\n".as_bytes()).unwrap();assert_eq!(ignored,vec!["extra"]);assert_eq!(rows[0]["extra"],"");assert!(parse_csv(b"name,platform\na,pve\n").is_err());}
}
