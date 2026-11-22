use serde_json::{json,Value};
use sqlx::{Postgres,QueryBuilder};
use super::resource::{validate,VM,Resource,issue,coerce_bool};
use crate::api::deps::ApiError;
use crate::api::inventory_alerts::{INVENTORY, duplicate_ip_networks, duplicate_ip_predicate};
use std::collections::BTreeMap;
pub type Params=BTreeMap<String,Vec<String>>;
pub fn query(raw:Option<String>)->Params {let mut p=Params::new();if let Some(raw)=raw{for pair in raw.split('&'){let(k,v)=pair.split_once('=').unwrap_or((pair,""));p.entry(decode(k)).or_default().push(decode(v));}}p}
fn decode(s:&str)->String{let mut bytes=Vec::new();let b=s.as_bytes();let mut i=0;while i<b.len(){if b[i]==b'%'&&i+2<b.len(){if let Ok(n)=u8::from_str_radix(&s[i+1..i+3],16){bytes.push(n);i+=3;continue;}}bytes.push(if b[i]==b'+'{b' '}else{b[i]});i+=1;}String::from_utf8_lossy(&bytes).into_owned()}
pub fn first<'a>(p:&'a Params,k:&str)->Option<&'a str>{p.get(k).and_then(|v|v.last()).map(String::as_str)}
pub fn boolean(p:&Params,k:&str)->Result<Option<bool>,ApiError>{first(p,k).map(|s|coerce_bool(&json!(s)).ok_or_else(||ApiError::validation(vec![issue(vec![json!("query"),json!(k)],"bool_parsing","Input should be a valid boolean, unable to interpret input",&json!(s))]))).transpose()}
pub fn bounded(p:&Params,key:&str,default:i64,min:i64,max:Option<i64>)->Result<i64,ApiError>{
 let Some(s)=first(p,key)else{return Ok(default)};
 let n=s.parse::<i64>().map_err(|_|ApiError::validation(vec![issue(vec![json!("query"),json!(key)],"int_parsing","Input should be a valid integer, unable to parse string as an integer",&json!(s))]))?;
 if n<min||max.is_some_and(|m|n>m){let high=n>=min;let bound=if high{max.unwrap()}else{min};let mut e=issue(vec![json!("query"),json!(key)],if high{"less_than_equal"}else{"greater_than_equal"},format!("Input should be {} than or equal to {bound}",if high{"less"}else{"greater"}),&json!(s));e["ctx"]=if high{json!({"le":bound})}else{json!({"ge":bound})};return Err(ApiError::validation(vec![e]));}Ok(n)
}
pub fn check_filter_enum(key:&str,value:&str)->Result<(),ApiError>{
    if key=="status"&&value=="unknown"{return Ok(());}
    if key=="os_family"{
        if ["linux","windows","undefined"].contains(&value){return Ok(());}
        let expected="'linux', 'windows' or 'undefined'";let mut e=issue(vec![json!("body"),json!(key)],"enum",format!("Input should be {expected}"),&json!(value));e["ctx"]=json!({"expected":expected});return Err(ApiError::validation(vec![e]));
    }
    let field=if key=="ip_role"{"role"}else{key};let r=Resource{table:"bulk",fields:if key=="ip_role"{"role"}else{VM.fields},..VM};validate(r,json!({field:value}),false)?;Ok(())
}
pub fn validate_query(p:&Params)->Result<(),ApiError>{
 let mut errors=Vec::new();
 for key in ["platform","status","environment","criticality","os_family","ip_role"]{if let Some(values)=p.get(key){for(i,s)in values.iter().enumerate(){
  if let Err(e)=check_filter_enum(key,s){if let Some(Value::Array(es))=e.detail{for mut e in es{e["loc"]=json!(["query",key,i]);errors.push(e);}}}
 }}}
 for key in ["monitoring_enabled","pmp_enabled","shutdown_stale","decommission_overdue","missing_ip","duplicate_ip","all"]{if let Err(e)=boolean(p,key){errors.extend(e.detail.unwrap().as_array().unwrap().iter().cloned());}}
 for(key,values)in p{if key.ends_with("_op"){let s=values.last().unwrap();if !["eq","neq","contains"].contains(&s.as_str()){let mut e=issue(vec![json!("query"),json!(key)],"enum","Input should be 'eq', 'neq' or 'contains'",&json!(s));e["ctx"]=json!({"expected":"'eq', 'neq' or 'contains'"});errors.push(e);}}}
 const VALID_SORT: &[&str] = &[
  "name", "platform", "cluster", "status", "resources", "criticality",
  "private_ip", "public_ip", "backup_ip", "updated_at", "created_at",
  "virtual_hosts", "environment", "vm_type", "datacenter", "node",
  "os_family", "owner", "business_owner", "technical_owner",
  "pmp_enabled", "monitoring_enabled", "backup_enabled", "ha_enabled",
  "health_score", "health", "tags", "cpu_cores", "memory_mb",
 ];
 const SORT_PATTERN: &str = "^(name|platform|cluster|status|resources|criticality|private_ip|public_ip|backup_ip|updated_at|created_at|virtual_hosts|environment|vm_type|datacenter|node|os_family|owner|business_owner|technical_owner|pmp_enabled|monitoring_enabled|backup_enabled|ha_enabled|health_score|health|tags|cpu_cores|memory_mb)$";
 for(key,valid,pattern)in[("health",vec!["below_50","below_75","complete"],"^(below_50|below_75|complete)$"),("dir",vec!["asc","desc"],"^(asc|desc)$"),("sort",VALID_SORT.to_vec(),SORT_PATTERN)]{if let Some(s)=first(p,key){if !valid.contains(&s){let mut e=issue(vec![json!("query"),json!(key)],"string_pattern_mismatch",format!("String should match pattern '{pattern}'"),&json!(s));e["ctx"]=json!({"pattern":pattern});errors.push(e);}}}
 if errors.is_empty(){Ok(())}else{Err(ApiError::validation(errors))}
}
pub fn apply(b:&mut QueryBuilder<Postgres>,p:&Params)->Result<(),ApiError>{
 for key in ["platform","status","environment","criticality","os_family","node","cluster"]{if let Some(values)=p.get(key).filter(|v|!v.is_empty()){for v in values {if ["platform","status","environment","criticality","os_family"].contains(&key){check_filter_enum(key,v)?;}}let op=first(p,&format!("{key}_op")).unwrap_or("eq");check_op(op)?;b.push(" AND (");let col=if key=="os_family"{format!("coalesce(v.{key}::text,'undefined')")}else{format!("v.{key}::text")};b.push(format!("{col} "));if op=="neq"{b.push("NOT ");}b.push("IN (");let mut s=b.separated(",");for v in values{s.push_bind(v.clone());}s.push_unseparated(")");if op=="neq"&&key!="os_family"{b.push(format!(" OR v.{key} IS NULL"));}b.push(")");}}
 for key in ["monitoring_enabled","pmp_enabled"]{if let Some(v)=boolean(p,key)?{let op=first(p,&format!("{key}_op")).unwrap_or("eq");check_op(op)?;b.push(format!(" AND v.{key} {} ",if op=="neq"{"<>"}else{"="})).push_bind(v);}}
 if let Some(q)=first(p,"q").filter(|s|!s.is_empty()){b.push(" AND (");for(i,key)in ["name","cluster","owner","external_id","sr_id","os_distribution","os_version"].iter().enumerate(){if i>0{b.push(" OR ");}b.push(format!("lower(coalesce(v.{key},'')) LIKE ")).push_bind(format!("%{}%",q.trim().to_lowercase()));}b.push(" OR v.tags::text LIKE ").push_bind(format!("%{}%",q.trim()));b.push(" OR EXISTS(SELECT 1 FROM unnest(v.virtual_hosts) vh WHERE lower(vh) LIKE ").push_bind(format!("%{}%",q.trim().to_lowercase())).push(")");for(table,col)in[("vm_networks","ip_address"),("vm_applications","app_name")]{b.push(format!(" OR EXISTS(SELECT 1 FROM {table} x WHERE x.vm_id=v.id AND lower(x.{col}) LIKE ")).push_bind(format!("%{}%",q.trim().to_lowercase())).push(")");}b.push(")");}
 for key in ["owner","tag","application"]{if let Some(values)=p.get(key).filter(|v|!v.is_empty()){let op=first(p,&format!("{key}_op")).unwrap_or(if key=="application"{"contains"}else{"eq"});check_op(op)?;b.push(" AND ");if op=="neq"{b.push("NOT ");}b.push("(");for(i,value)in values.iter().enumerate(){if i>0{b.push(" OR ");}match key{"owner"=>{b.push("(");for(j,col)in["owner","business_owner","technical_owner"].iter().enumerate(){if j>0{b.push(" OR ");}b.push(format!("lower(coalesce(v.{col},'')) = ")).push_bind(value.trim().to_lowercase());}b.push(")");},"tag"=>{b.push("v.tags @> ").push_bind(json!([value.trim()]));},_=>{b.push("EXISTS(SELECT 1 FROM vm_applications a WHERE a.vm_id=v.id AND lower(a.app_name) ");b.push(if op=="contains"{"LIKE "}else{"= "});b.push_bind(if op=="contains"{format!("%{}%",value.trim().to_lowercase())}else{value.trim().to_lowercase()}).push(")");}}}b.push(")");}}
 if let Some(roles)=p.get("ip_role").filter(|v|!v.is_empty()){b.push(" AND EXISTS(SELECT 1 FROM vm_networks n WHERE n.vm_id=v.id AND n.role::text IN (");let mut s=b.separated(",");for role in roles{if !["private","public","backup"].contains(&role.as_str()){return Err(ApiError::invalid("Invalid ip_role"));}s.push_bind(role.clone());}s.push_unseparated("))");}
 if let Some(health)=first(p,"health"){let cond=match health{"below_50"=>"v.health_score<50","below_75"=>"v.health_score<75","complete"=>"v.health_score>=100",_=>return Err(ApiError::invalid("Invalid health"))};b.push(format!(" AND {cond} AND NOT jsonb_path_exists(v.tags,'$[*] ? (@ like_regex \"^(template|backup)$\" flag \"i\")')"));}
 for(key,expr)in[("shutdown_stale","v.status='powered_off' AND coalesce((SELECT max(changed_at) FROM audit_log WHERE vm_id=v.id AND field_name='status' AND new_value='powered_off'),v.created_at)<=now()-interval '90 days'"),("decommission_overdue","v.decommission_date IS NOT NULL AND v.decommission_date<=(now() AT TIME ZONE 'UTC')::date AND v.status<>'decommissioned'"),("missing_ip","NOT EXISTS(SELECT 1 FROM vm_networks WHERE vm_id=v.id)")]{if let Some(value)=boolean(p,key)?{b.push(" AND ");if !value{b.push("NOT ");}b.push(format!("({expr})"));}}
 if let Some(value) = boolean(p, "duplicate_ip")? {
     let predicate = duplicate_ip_predicate(&duplicate_ip_networks());
     let negation = if value { "" } else { "NOT " };
     b.push(format!(" AND {negation}({predicate})"));
 }
 if ["shutdown_stale","decommission_overdue","missing_ip","duplicate_ip"].iter().any(|key|first(p,key).is_some()){b.push(format!(" AND {INVENTORY}"));}
 Ok(())}
fn check_op(op:&str)->Result<(),ApiError>{if ["eq","neq","contains"].contains(&op){Ok(())}else{Err(ApiError::invalid("Invalid filter operator"))}}
pub fn ordering(p:&Params)->Result<String,ApiError>{
    let dir=first(p,"dir").unwrap_or("asc");
    if !["asc","desc"].contains(&dir){return Err(ApiError::invalid("Invalid sort direction"));}
    let key=match first(p,"sort"){
        None=>return Ok("v.updated_at DESC,v.name ASC".into()),
        Some(k)=>k,
    };
    let order_sql=match key{
        "name"=>format!("lower(v.name) {dir},v.name ASC"),
        "status"=>format!("CASE v.status WHEN 'running' THEN 0 WHEN 'powered_off' THEN 1 WHEN 'unknown' THEN 2 ELSE 3 END {dir},v.name ASC"),
        "criticality"=>format!("CASE v.criticality WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END {dir},v.name ASC"),
        "health"|"health_score"=>format!("v.health_score {dir},v.name ASC"),
        "cpu_cores"=>format!("v.cpu_cores {dir},v.name ASC"),
        "memory_mb"=>format!("v.memory_mb {dir},v.name ASC"),
        "resources"=>format!("v.cpu_cores {dir},v.memory_mb {dir},v.name ASC"),
        "updated_at"=>format!("v.updated_at {dir},v.name ASC"),
        "created_at"=>format!("v.created_at {dir},v.name ASC"),
        "platform"=>format!("v.platform {dir},v.name ASC"),
        "environment"=>format!("v.environment {dir},v.name ASC"),
        "cluster"=>format!("lower(v.cluster) {dir},v.name ASC"),
        "owner"=>format!("lower(v.owner) {dir},v.name ASC"),
        "business_owner"=>format!("lower(v.business_owner) {dir},v.name ASC"),
        "technical_owner"=>format!("lower(v.technical_owner) {dir},v.name ASC"),
        "datacenter"=>format!("lower(v.datacenter) {dir},v.name ASC"),
        "node"=>format!("lower(v.node) {dir},v.name ASC"),
        "vm_type"=>format!("lower(v.vm_type::text) {dir},v.name ASC"),
        "os_family"=>format!("lower(coalesce(v.os_family::text,'undefined')) {dir},v.name ASC"),
        "pmp_enabled"=>format!("v.pmp_enabled {dir},v.name ASC"),
        "monitoring_enabled"=>format!("v.monitoring_enabled {dir},v.name ASC"),
        "backup_enabled"=>format!("v.backup_enabled {dir},v.name ASC"),
        "ha_enabled"=>format!("v.ha_enabled {dir},v.name ASC"),
        "virtual_hosts"=>format!("(SELECT lower(vh) FROM unnest(v.virtual_hosts) AS vh ORDER BY lower(vh) ASC LIMIT 1) {dir},v.name ASC"),
        "tags"=>format!("(CASE WHEN jsonb_typeof(v.tags)='array' THEN (SELECT lower(elem) FROM jsonb_array_elements_text(v.tags) AS elem ORDER BY lower(elem) ASC LIMIT 1) END) {dir},v.name ASC"),
        "private_ip"|"public_ip"|"backup_ip"=>{
            let role=match key{
                "private_ip"=>"private",
                "public_ip"=>"public",
                "backup_ip"=>"backup",
                _=>unreachable!(),
            };
            format!(
                "(SELECT CASE WHEN n.ip_address ~ '^((25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])\\.){{3}}(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])$' THEN n.ip_address::inet END FROM vm_networks n WHERE n.vm_id=v.id AND n.role='{role}' ORDER BY n.sort_order, n.id LIMIT 1) {dir}, (SELECT n.ip_address FROM vm_networks n WHERE n.vm_id=v.id AND n.role='{role}' ORDER BY n.sort_order, n.id LIMIT 1) {dir},v.name ASC"
            )
        }
        _=>return Err(ApiError::invalid("Invalid sort")),
    };
    Ok(order_sql)
}
#[cfg(test)]mod validation_tests{use super::*;
 #[test]fn repeated_enum_error_has_query_index(){let p=query(Some("status=running&status=stopped&platform=invalid".into()));let e=validate_query(&p).unwrap_err();let d=e.detail.unwrap();assert!(d.as_array().unwrap().iter().any(|e|e["loc"]==json!(["query","status",1])));assert!(d.as_array().unwrap().iter().any(|e|e["loc"]==json!(["query","platform",0])));}
 #[test]fn negative_limit_is_a_bound_error(){let p=query(Some("limit=-1".into()));let e=bounded(&p,"limit",50,1,Some(200)).unwrap_err();assert_eq!(e.detail.unwrap(),json!([{"type":"greater_than_equal","loc":["query","limit"],"msg":"Input should be greater than or equal to 1","input":"-1","ctx":{"ge":1}}]));}
 #[test]fn os_family_undefined_accepted_in_query(){let p=query(Some("os_family=undefined".into()));assert!(validate_query(&p).is_ok());}
 #[test]fn os_family_invalid_rejected_in_query(){let p=query(Some("os_family=bsd".into()));let e=validate_query(&p).unwrap_err();let d=e.detail.unwrap();assert_eq!(d[0]["loc"],json!(["query","os_family",0]));assert!(d[0]["msg"].as_str().unwrap().contains("undefined"));}
 #[test]fn os_family_eq_sql_uses_coalesce(){let p=query(Some("os_family=linux".into()));let mut b=QueryBuilder::new("SELECT 1 FROM vms v WHERE true");apply(&mut b,&p).unwrap();let sql=b.sql();assert!(sql.as_str().contains("coalesce(v.os_family"));assert!(!sql.as_str().contains("IS NULL"));}
 #[test]fn os_family_neq_sql_no_null_fallback(){let p=query(Some("os_family=linux&os_family_op=neq".into()));let mut b=QueryBuilder::new("SELECT 1 FROM vms v WHERE true");apply(&mut b,&p).unwrap();let sql=b.sql();assert!(sql.as_str().contains("coalesce(v.os_family"));assert!(sql.as_str().contains("NOT IN"));assert!(!sql.as_str().contains("IS NULL"));}
 #[test]fn os_family_mixed_with_undefined(){let p=query(Some("os_family=linux&os_family=undefined".into()));let mut b=QueryBuilder::new("SELECT 1 FROM vms v WHERE true");apply(&mut b,&p).unwrap();let sql=b.sql();assert!(sql.as_str().contains("coalesce(v.os_family"));}
 #[test]fn other_enum_neq_still_has_null_fallback(){let p=query(Some("status=running&status_op=neq".into()));let mut b=QueryBuilder::new("SELECT 1 FROM vms v WHERE true");apply(&mut b,&p).unwrap();let sql=b.sql();assert!(sql.as_str().contains("IS NULL"));}
 #[test]fn vm_payload_undefined_os_family_rejected(){assert!(validate(VM,json!({"os_family":"undefined"}),false).is_err());}
 #[test]fn legacy_unknown_status_is_readable(){let p=query(Some("status=unknown".into()));assert!(validate_query(&p).is_ok());let mut b=QueryBuilder::new("SELECT 1 FROM vms v WHERE true");assert!(apply(&mut b,&p).is_ok());assert!(validate(VM,json!({"status":"unknown"}),false).is_err());}
 #[test]fn ordering_accepts_all_columns_in_both_directions(){
     let keys = [
         "name", "platform", "cluster", "status", "resources", "criticality",
         "private_ip", "public_ip", "backup_ip", "updated_at", "created_at",
         "virtual_hosts", "environment", "vm_type", "datacenter", "node",
         "os_family", "owner", "business_owner", "technical_owner",
         "pmp_enabled", "monitoring_enabled", "backup_enabled", "ha_enabled",
         "health_score", "health", "tags", "cpu_cores", "memory_mb",
     ];
     for key in keys {
         for dir in ["asc", "desc"] {
             let q = query(Some(format!("sort={key}&dir={dir}")));
             assert!(validate_query(&q).is_ok(), "validate_query should accept sort={key}");
             let sql = ordering(&q).unwrap();
             assert!(sql.contains(dir), "sql for {key} {dir} must contain {dir}");
             assert!(sql.ends_with(",v.name ASC"), "sql for {key} {dir} must end with tie-breaker");
         }
     }
 }
 #[test]fn ordering_default_when_no_sort(){
     let q = query(None);
     assert_eq!(ordering(&q).unwrap(), "v.updated_at DESC,v.name ASC");
 }
 #[test]fn ordering_rejects_unknown_column_and_injection(){
     for invalid in ["not_a_column", "name; DROP TABLE vms;", "' OR '1'='1", "unknown_key"] {
         let q = query(Some(format!("sort={invalid}")));
         assert!(ordering(&q).is_err());
         assert!(validate_query(&q).is_err());
     }
 }
 #[test]fn ordering_rejects_invalid_direction(){
     for invalid_dir in ["up", "down", "asc; DROP TABLE vms;", "ASC"] {
         let q = query(Some(format!("sort=name&dir={invalid_dir}")));
         assert!(ordering(&q).is_err());
         assert!(validate_query(&q).is_err());
     }
 }
}

