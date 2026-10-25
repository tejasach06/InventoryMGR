use serde_json::{json, Value};
use axum::http::StatusCode;
use crate::api::deps::ApiError;

#[derive(Clone, Copy)]
pub struct Resource { pub table: &'static str, pub fields: &'static str, pub required: &'static str, pub defaults: &'static str, pub parent: Option<(&'static str, &'static str)>, pub missing: &'static str, pub stamped: bool }
pub const VM: Resource = Resource {table:"vms", fields:"external_id name fqdn description platform datacenter sr_id cluster node status environment cpu_cores memory_mb os_family os_distribution os_version owner business_owner technical_owner pmp_enabled monitoring_enabled backup_enabled backup_location ha_enabled criticality vm_type tags last_patch_date last_vuln_scan_date security_remarks decommission_date last_verified_at",required:"name platform cluster status criticality cpu_cores memory_mb",defaults:r#"{"environment":"production","vm_type":"permanent","pmp_enabled":false,"monitoring_enabled":false,"backup_enabled":false,"ha_enabled":false,"tags":[],"health_score":0}"#,parent:None,missing:"VM not found",stamped:true};
pub const CLUSTER: Resource = Resource {table:"physical_clusters",fields:"name description notes",required:"name",defaults:"{}",parent:None,missing:"Cluster not found",stamped:true};
pub const ARRAY: Resource = Resource {table:"storage_arrays",fields:"name vendor model mgmt_host datacenter description total_capacity_gb used_capacity_gb notes",required:"name vendor",defaults:r#"{"total_capacity_gb":0,"used_capacity_gb":0}"#,parent:None,missing:"Storage array not found",stamped:true};
pub const NODE: Resource = Resource {table:"physical_nodes",fields:"name cpu_model cpu_cores cpu_threads ram_total_gb ram_used_gb storage_usable_gb datacenter rack rack_unit ip_addresses notes sort_order",required:"name",defaults:r#"{"cpu_cores":0,"cpu_threads":0,"ram_total_gb":0,"storage_usable_gb":0,"ip_addresses":[],"sort_order":0}"#,parent:Some(("physical_clusters","cluster_id")),missing:"Node not found",stamped:true};
pub const DISK: Resource = Resource {table:"vm_disks",fields:"disk_name storage_name size_gb storage_type sort_order",required:"disk_name",defaults:r#"{"size_gb":0,"sort_order":0}"#,parent:Some(("vms","vm_id")),missing:"Disk not found",stamped:false};
pub const NETWORK: Resource = Resource {table:"vm_networks",fields:"ip_address role sort_order",required:"ip_address",defaults:r#"{"role":"private","sort_order":0}"#,parent:Some(("vms","vm_id")),missing:"Network entry not found",stamped:false};
pub const APPLICATION: Resource = Resource {table:"vm_applications",fields:"app_name app_owner description",required:"app_name",defaults:"{}",parent:Some(("vms","vm_id")),missing:"Application not found",stamped:false};
pub const VOLUME: Resource = Resource {table:"storage_volumes",fields:"name capacity_gb used_gb notes sort_order",required:"name",defaults:r#"{"capacity_gb":0,"used_gb":0,"sort_order":0}"#,parent:Some(("storage_arrays","array_id")),missing:"Volume not found",stamped:false};
pub const LUN: Resource = Resource {table:"storage_luns",fields:"name size_gb used_gb target_iqn cluster status sort_order",required:"name",defaults:r#"{"size_gb":0,"sort_order":0}"#,parent:Some(("storage_volumes","volume_id")),missing:"LUN not found",stamped:false};
pub const SHARE: Resource = Resource {table:"storage_nfs_shares",fields:"export_path used_gb allowed_clients notes sort_order",required:"export_path",defaults:r#"{"sort_order":0}"#,parent:Some(("storage_volumes","volume_id")),missing:"NFS share not found",stamped:false};

pub fn invalid(message: impl Into<String>) -> ApiError { ApiError::new(StatusCode::UNPROCESSABLE_ENTITY,message) }
pub fn issue(loc: Vec<Value>, kind: &str, message: impl Into<String>, input: &Value) -> Value {
 json!({"type":kind,"loc":loc,"msg":message.into(),"input":input})
}
pub fn field_error(field:&str,kind:&str,message:impl Into<String>,input:&Value)->ApiError {
 ApiError::validation(vec![issue(vec![json!("body"),json!(field)],kind,message,input)])
}
pub fn prefix_error(mut e:ApiError,prefix:&[Value])->ApiError {
 if let Some(Value::Array(errors))=&mut e.detail {for error in errors {if let Some(Value::Array(loc))=error.get_mut("loc"){loc.splice(1..1,prefix.iter().cloned());}}}
 e
}
pub fn coerce_bool(v:&Value)->Option<bool>{match v {
 Value::Bool(b)=>Some(*b),
 Value::Number(n)=>match n.as_f64()? {0.0=>Some(false),1.0=>Some(true),_=>None},
 Value::String(s)=>match s.to_lowercase().as_str(){"0"|"off"|"f"|"false"|"n"|"no"=>Some(false),"1"|"on"|"t"|"true"|"y"|"yes"=>Some(true),_=>None},
 _=>None
}}
fn coerce_int(v:&Value)->Option<i64>{
 match v {Value::Bool(b)=>Some(i64::from(*b)),Value::Number(n)=>n.as_i64().or_else(||{let f=n.as_f64()?;(f.is_finite()&&f.fract()==0.0&&f>=i64::MIN as f64&&f<i64::MAX as f64).then_some(f as i64)}),
 Value::String(s)=>{let s=s.trim();s.parse().ok().or_else(||{let (whole,fraction)=s.split_once('.')?;if !fraction.is_empty()&&fraction.bytes().all(|b|b==b'0'){whole.parse().ok()}else{None}})},_=>None}
}
const INTEGERS:&str="cpu_cores memory_mb cpu_threads ram_total_gb ram_used_gb storage_usable_gb size_gb capacity_gb used_gb total_capacity_gb used_capacity_gb sort_order";
fn date_value(v:&Value)->Option<chrono::NaiveDate>{
 if let Some(s)=v.as_str(){if let Ok(date)=chrono::NaiveDate::parse_from_str(s,"%Y-%m-%d"){return Some(date);}if let Ok(dt)=chrono::DateTime::parse_from_rfc3339(s){return (dt.time()==chrono::NaiveTime::MIN).then_some(dt.date_naive());}if let Ok(dt)=chrono::NaiveDateTime::parse_from_str(s,"%Y-%m-%dT%H:%M:%S%.f"){return (dt.time()==chrono::NaiveTime::MIN).then_some(dt.date());}}
 let n=if v.is_boolean(){return None}else{v.as_f64().or_else(||v.as_str()?.parse::<f64>().ok())?};
 let seconds=if n.abs()>20_000_000_000.0{n/1000.0}else{n};
 if !seconds.is_finite()||seconds.fract()!=0.0{return None;}
 let dt=chrono::DateTime::from_timestamp(seconds as i64,0)?;
 (dt.time()==chrono::NaiveTime::MIN).then_some(dt.date_naive())
}
fn validate_field(r:Resource,field:&str,v:&mut Value,create:bool)->Result<(),ApiError>{
 let error=|kind:&str,msg:String|field_error(field,kind,msg,v);
 if v.is_null(){
  let defaults:Value=serde_json::from_str(r.defaults).unwrap();
  if create&&(r.required.split_whitespace().any(|f|f==field)||defaults.get(field).is_some()) {
   let(kind,msg)=if INTEGERS.split_whitespace().any(|f|f==field){("int_type","Input should be a valid integer")}else if field.ends_with("_enabled"){("bool_type","Input should be a valid boolean")}else if field=="ip_addresses"{("list_type","Input should be a valid list")}else if field=="tags"{("list_type","Input should be a valid list")}else if ["platform","status","environment","criticality","vm_type","role","vendor"].contains(&field){("enum","Input should be a valid enum value")}else{("string_type","Input should be a valid string")};
   return Err(error(kind,msg.into()));
  }
  return Ok(());
 }
 if INTEGERS.split_whitespace().any(|f|f==field){
  let n=coerce_int(v).ok_or_else(||{let(kind,msg)=if v.is_number(){("int_from_float","Input should be a valid integer, got a number with a fractional part")}else if v.is_string(){("int_parsing","Input should be a valid integer, unable to parse string as an integer")}else{("int_type","Input should be a valid integer")};error(kind,msg.into())})?;
  if field!="sort_order"&&n<0 {let mut e=error("greater_than_equal","Input should be greater than or equal to 0".into());e.detail.as_mut().unwrap()[0]["ctx"]=json!({"ge":0});return Err(e);}
  *v=json!(n);return Ok(());
 }
 if field.ends_with("_enabled"){let b=coerce_bool(v).ok_or_else(||error("bool_parsing","Input should be a valid boolean, unable to interpret input".into()))?;*v=json!(b);return Ok(());}
 if field=="tags" {let a=v.as_array().ok_or_else(||error("value_error","Value error, tags must be a list of strings".into()))?;*v=json!(a.iter().filter_map(Value::as_str).map(str::trim).filter(|s|!s.is_empty()).collect::<Vec<_>>());return Ok(());}
 if field=="ip_addresses"{
  let a=v.as_array().ok_or_else(||error("list_type","Input should be a valid list".into()))?;
  let mut items=Vec::with_capacity(a.len());let mut errors=Vec::new();
  for (index,item) in a.iter().enumerate(){
   if !item.is_object(){errors.push(issue(vec![json!("body"),json!(field),json!(index)],"model_attributes_type","Input should be a valid dictionary or object to extract fields from",item));continue;}
   let mut ip=json!({});for(key,max)in[("label",100),("address",255)]{
    let loc=vec![json!("body"),json!(field),json!(index),json!(key)];
    match item.get(key){
     None=>errors.push(issue(loc,"missing","Field required",item)),
     Some(Value::String(s)) if !s.is_empty()&&s.chars().count()<=max=>ip[key]=json!(s),
     Some(Value::String(s))=>{let long=s.chars().count()>max;let mut e=issue(loc,if long{"string_too_long"}else{"string_too_short"},if long{format!("String should have at most {max} characters")}else{"String should have at least 1 character".into()},&json!(s));e["ctx"]=if long{json!({"max_length":max})}else{json!({"min_length":1})};errors.push(e);}
     Some(value)=>errors.push(issue(loc,"string_type","Input should be a valid string",value))
    }
   }items.push(ip);
  }
  if !errors.is_empty(){return Err(ApiError::validation(errors));}*v=json!(items);return Ok(());
 }
 if field.ends_with("_date")||field=="last_verified_at"{let date=date_value(v).ok_or_else(||error("date_from_datetime_parsing","Input should be a valid date or datetime".into()))?;*v=json!(date.to_string());return Ok(());}
 let s=v.as_str().ok_or_else(||error("string_type","Input should be a valid string".into()))?;
 let choices=match field{"platform"=>Some("proxmox vmware"),"environment"=>Some("production development testing uat dr staging sandbox"),"criticality"=>Some("low medium high critical"),"vm_type"=>Some("permanent temporary"),"os_family"=>Some("linux windows"),"role"=>Some("private public backup"),"vendor"=>Some("synology netapp"),"status" if r.table=="vms"||r.table=="bulk"=>Some("running powered_off decommissioned unknown"),_=>None};
 if let Some(choices)=choices {
  let s=if r.table=="vms"{s.trim().to_lowercase()}else{s.into()};let mut names:Vec<_>=choices.split_whitespace().map(|c|format!("'{c}'")).collect();let last=names.pop().unwrap();let expected=if names.is_empty(){last}else{format!("{} or {last}",names.join(", "))};
  if !choices.split_whitespace().any(|c|c==s){let mut e=field_error(field,"enum",format!("Input should be {expected}"),&json!(s));e.detail.as_mut().unwrap()[0]["ctx"]=json!({"expected":expected});return Err(e);}*v=json!(s);return Ok(());
 }
 let max=match field{"name" if r.table!="vms"=>Some(255),"export_path"=>Some(500),"sr_id"=>Some(50),"ip_address"=>Some(64),_=>None};
 if let Some(max)=max{if s.chars().count()>max{let mut e=error("string_too_long",format!("String should have at most {max} characters"));e.detail.as_mut().unwrap()[0]["ctx"]=json!({"max_length":max});return Err(e);}if ["name","export_path"].contains(&field)&&s.is_empty(){let mut e=error("string_too_short","String should have at least 1 character".into());e.detail.as_mut().unwrap()[0]["ctx"]=json!({"min_length":1});return Err(e);}}
 if field=="ip_address"{*v=json!(crate::core::ip_utils::normalize_ip(s));}
 Ok(())
}
pub fn validate(r: Resource, payload: Value, create: bool) -> Result<Value, ApiError> {
 let source=payload.as_object().ok_or_else(||ApiError::validation(vec![issue(vec![json!("body")],"model_attributes_type","Input should be a valid dictionary or object to extract fields from",&payload)]))?;
 let mut result=if create {serde_json::from_str::<Value>(r.defaults).unwrap().as_object().unwrap().clone()} else {serde_json::Map::new()};
 let mut errors=Vec::new();
 for field in r.fields.split_whitespace(){
  if let Some(input)=source.get(field){
   let mut v=input.clone();
   if r.table=="vms"&&"external_id name fqdn description datacenter sr_id cluster node os_distribution os_version owner business_owner technical_owner backup_location security_remarks".split_whitespace().any(|f|f==field){if let Some(s)=v.as_str(){v=if s.trim().is_empty(){Value::Null}else{json!(s.trim())};}}
   match validate_field(r,field,&mut v,create){Ok(())=>{result.insert(field.into(),v);},Err(e)=>errors.extend(e.detail.unwrap().as_array().unwrap().iter().cloned())}
  }else if create&&r.required.split_whitespace().any(|f|f==field){errors.push(issue(vec![json!("body"),json!(field)],"missing","Field required",&payload));}
 }
 if !errors.is_empty(){return Err(ApiError::validation(errors));}
 if r.table=="vms"{for field in ["name","cluster"]{if result.get(field).is_some_and(|v|v.is_null()){return Err(ApiError::validation(vec![issue(vec![json!("body")],"value_error",format!("Value error, {field} cannot be blank"),&payload)]));}}}
 Ok(Value::Object(result))
}
pub fn validate_vm_request(payload:&Value,create:bool)->Result<(),ApiError>{
 let mut errors=Vec::new();
 if let Err(e)=validate(VM,payload.clone(),create){errors.extend(e.detail.unwrap().as_array().unwrap().iter().cloned());}
 for(field,r)in[("disks",DISK),("networks",NETWORK)]{if let Some(items)=payload.get(field){
  if let Some(items)=items.as_array(){for(index,item)in items.iter().enumerate(){if let Err(e)=validate(r,item.clone(),true){let e=prefix_error(e,&[json!(field),json!(index)]);errors.extend(e.detail.unwrap().as_array().unwrap().iter().cloned());}}}
  else{errors.push(issue(vec![json!("body"),json!(field)],"sequence_str","Input should be a valid sequence",items));}
 }}
 if errors.is_empty(){Ok(())}else{Err(ApiError::validation(errors))}
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn absent_and_null_are_distinct(){assert_eq!(validate(VM,json!({}),false).unwrap(),json!({}));assert_eq!(validate(VM,json!({"owner":null}),false).unwrap(),json!({"owner":null}));}
 #[test] fn normalize_vm_strings_tags_enums(){let v=validate(VM,json!({"name":" x ","platform":" VMWARE ","owner":" ","tags":[" a ",42," "]}),false).unwrap();assert_eq!(v,json!({"name":"x","platform":"vmware","owner":null,"tags":["a"]}));}
 #[test] fn reject_invalid_capacity_and_identity(){assert!(validate(VM,json!({"name":" "}),false).is_err());assert!(validate(DISK,json!({"disk_name":"d","size_gb":-1}),true).is_err());assert!(validate(ARRAY,json!({"name":"a","vendor":"unknown"}),true).is_err());}
 #[test] fn normalize_ip_like_python(){assert_eq!(validate(NETWORK,json!({"ip_address":" 10.1.2.3/24 "}),true).unwrap()["ip_address"],"10.1.2.3");}
 #[test] fn protect_system_columns(){assert!(validate(CLUSTER,json!({"name":"a","id":"injected","created_by_id":"injected"}),true).unwrap().get("id").is_none());}
 #[test]fn required_errors_follow_source_schema_order(){let e=validate(VM,json!({"name":"","cpu_cores":-1}),true).unwrap_err();let d=e.detail.unwrap();assert_eq!(d.as_array().unwrap().iter().map(|e|e["loc"][1].as_str().unwrap()).collect::<Vec<_>>(),vec!["name","platform","cluster","status","cpu_cores","memory_mb","criticality"]);assert_eq!(d[0]["input"],Value::Null);}
 #[test]fn date_and_null_types_match_source(){
  for input in [json!("2024-01-01T00:00:00"),json!(1704067200),json!(1704067200000i64)]{assert_eq!(validate(VM,json!({"last_verified_at":input}),false).unwrap()["last_verified_at"],"2024-01-01");}
  for(r,field,kind)in[(NODE,"cpu_cores","int_type"),(VM,"monitoring_enabled","bool_type"),(NODE,"ip_addresses","list_type")]{assert_eq!(validate(r,json!({field:null}),true).unwrap_err().detail.unwrap().as_array().unwrap().iter().find(|e|e["loc"][1]==field).unwrap()["type"],kind);}
 }
 #[test]fn pydantic_number_and_bool_coercion(){
  for(r,field)in[(VM,"cpu_cores"),(NODE,"ram_total_gb"),(ARRAY,"total_capacity_gb"),(DISK,"size_gb"),(VOLUME,"capacity_gb"),(LUN,"size_gb"),(SHARE,"used_gb")]{
   for(input,expected)in[(json!(" 12 "),json!(12)),(json!("12.00"),json!(12)),(json!(12.0),json!(12)),(json!(true),json!(1))]{assert_eq!(validate(r,json!({field:input}),false).unwrap()[field],expected);}
   assert!(validate(r,json!({field:1.5}),false).is_err());
  }
  for(input,expected)in[(json!("YES"),true),(json!("off"),false),(json!(1.0),true),(json!(0),false)]{assert_eq!(validate(VM,json!({"monitoring_enabled":input}),false).unwrap()["monitoring_enabled"],expected);}
 }
 #[test]fn node_ip_projection_and_nested_locations(){
  assert_eq!(validate(NODE,json!({"ip_addresses":[{"label":"mgmt","address":"10.0.0.1","extra":"drop"}]}),false).unwrap()["ip_addresses"],json!([{"label":"mgmt","address":"10.0.0.1"}]));
  let e=validate(NODE,json!({"ip_addresses":[{"label":3,"address":"10.0.0.1"}]}),false).unwrap_err();assert_eq!(e.detail.unwrap()[0]["loc"],json!(["body","ip_addresses",0,"label"]));
 }
 #[tokio::test]async fn validation_response_is_renderable_by_frontend(){
  use axum::response::IntoResponse;
  let e=validate_vm_request(&json!({"cpu_cores":"wrong","networks":[{}],"disks":[{"disk_name":"d","size_gb":-1}]}),false).unwrap_err();
  let response=e.into_response();assert_eq!(response.status(),StatusCode::UNPROCESSABLE_ENTITY);
  let bytes=axum::body::to_bytes(response.into_body(),usize::MAX).await.unwrap();let body:Value=serde_json::from_slice(&bytes).unwrap();
  let errors=body["detail"].as_array().unwrap();assert_eq!(errors.len(),3);assert!(errors.iter().all(|e|e["msg"].is_string()&&e["type"].is_string()&&e["loc"][0]=="body"));
  assert!(errors.iter().any(|e|e["loc"]==json!(["body","disks",0,"size_gb"])));
  assert!(errors.iter().any(|e|e["loc"]==json!(["body","networks",0,"ip_address"])));
 }
}
