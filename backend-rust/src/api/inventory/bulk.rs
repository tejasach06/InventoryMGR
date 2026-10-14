use super::{filters::{self,Params},resource::*};
use crate::api::deps::ApiError;
use serde_json::{json,Value};
use uuid::Uuid;
use sqlx::QueryBuilder;
pub struct BulkRequest {pub params:Params,pub explicit_ids:bool,pub patch:Value,pub adds:Vec<String>,pub removes:Vec<String>}
fn strings(v:&Value,loc:Vec<Value>)->Result<Vec<String>,ApiError>{
 let a=v.as_array().ok_or_else(||ApiError::validation(vec![issue(loc.clone(),"list_type","Input should be a valid list",v)]))?;
 let mut result=Vec::new();let mut errors=Vec::new();for(i,v)in a.iter().enumerate(){if let Some(s)=v.as_str(){result.push(s.into());}else{let mut loc=loc.clone();loc.push(json!(i));errors.push(issue(loc,"string_type","Input should be a valid string",v));}}
 if errors.is_empty(){Ok(result)}else{Err(ApiError::validation(errors))}
}
pub fn validate_bulk(payload:&Value)->Result<BulkRequest,ApiError>{
 if !payload.is_object(){return Err(ApiError::validation(vec![issue(vec![json!("body")],"model_attributes_type","Input should be a valid dictionary",payload)]));}
 let mut errors=Vec::new();let mut collect=|e:ApiError|{if let Some(Value::Array(e))=e.detail{errors.extend(e);}};
 let mut params=Params::new();let explicit_ids=payload.get("ids").is_some_and(|v|!v.is_null());
 if let Some(v)=payload.get("ids").filter(|v|!v.is_null()) {match strings(v,vec![json!("body"),json!("ids")]){Ok(ids)=>{for(i,id)in ids.iter().enumerate(){if Uuid::parse_str(id).is_err(){collect(ApiError::validation(vec![issue(vec![json!("body"),json!("ids"),json!(i)],"uuid_parsing","Input should be a valid UUID",&json!(id))]));}}params.insert("ids".into(),ids);},Err(e)=>collect(e)}}
 let filter=payload.get("filters").filter(|v|!v.is_null());
 if let Some(v)=filter {if let Some(obj)=v.as_object(){for(k,v)in obj{
  let loc=vec![json!("body"),json!("filters"),json!(k)];
  let lists="platform cluster status environment criticality node os_family owner tag application ip_role";
  let bools="monitoring_enabled pmp_enabled shutdown_stale decommission_overdue missing_ip duplicate_ip";
  if !lists.split_whitespace().chain(bools.split_whitespace()).chain(["q","health"]).any(|a|a==k){collect(ApiError::validation(vec![issue(loc,"extra_forbidden","Extra inputs are not permitted",v)]));continue;}if v.is_null(){continue;}
  if lists.split_whitespace().any(|a|a==k){match strings(v,loc){Ok(values)=>{
   if ["platform","status","environment","criticality","os_family","ip_role"].contains(&k.as_str()){for(i,value)in values.iter().enumerate(){
    let field=if k=="ip_role"{"role"}else{k.as_str()};let r=Resource{table:"bulk",fields:if k=="ip_role"{"role"}else{VM.fields},..VM};
    if let Err(mut e)=validate(r,json!({field:value}),false){if let Some(Value::Array(errors))=&mut e.detail{for error in errors{error["loc"]=json!(["body","filters",k,i]);}}collect(e);}
   }}
   params.insert(k.clone(),values);
  },Err(e)=>collect(e)}}else if bools.split_whitespace().any(|a|a==k){match coerce_bool(v){Some(b)=>{params.insert(k.clone(),vec![b.to_string()]);},None=>collect(prefix_error(field_error(k,"bool_parsing","Input should be a valid boolean",v),&[json!("filters")]))}}else if let Some(s)=v.as_str(){params.insert(k.clone(),vec![s.into()]);}else{collect(ApiError::validation(vec![issue(loc,"string_type","Input should be a valid string",v)]));}
 }}else{collect(field_error("filters","model_attributes_type","Input should be a valid dictionary",v));}}
 let mut patch=json!({});let mut adds=Vec::new();let mut removes=Vec::new();
 if let Some(v)=payload.get("patch"){if let Some(obj)=v.as_object(){for(k,v)in obj{
  if !"status environment criticality vm_type cluster node datacenter owner business_owner technical_owner pmp_enabled monitoring_enabled backup_enabled ha_enabled backup_location last_verified_at tags_add tags_remove".split_whitespace().any(|a|a==k){collect(prefix_error(field_error(k,"extra_forbidden","Extra inputs are not permitted",v),&[json!("patch")]));continue;}
  if ["tags_add","tags_remove"].contains(&k.as_str()){match strings(v,vec![json!("body"),json!("patch"),json!(k)]){Ok(tags)=>if k=="tags_add"{adds=tags}else{removes=tags},Err(e)=>collect(e)}continue;}
  let r=Resource{table:"bulk",..VM};match validate(r,json!({k:v}),false){Ok(value)=>patch[k]=value[k].clone(),Err(e)=>collect(prefix_error(e,&[json!("patch")]))}
 }}else{collect(field_error("patch","model_attributes_type","Input should be a valid dictionary",v));}}else{collect(field_error("patch","missing","Field required",payload));}
 drop(collect);
 if !errors.is_empty(){return Err(ApiError::validation(errors));}
 if explicit_ids==filter.is_some(){return Err(ApiError::validation(vec![issue(vec![json!("body")],"value_error","Value error, supply exactly one of ids or filters",payload)]));}
 if explicit_ids&&params.get("ids").is_none_or(Vec::is_empty){return Err(ApiError::validation(vec![issue(vec![json!("body")],"value_error","Value error, ids must not be empty",payload)]));}
 if payload["patch"].as_object().is_none_or(|p|p.is_empty()){return Err(ApiError::validation(vec![issue(vec![json!("body")],"value_error","Value error, patch must set at least one field",payload)]));}
 if !explicit_ids{let mut q=QueryBuilder::new("SELECT id FROM vms v WHERE true");filters::apply(&mut q,&params).map_err(|e|if e.detail.is_some(){prefix_error(e,&[json!("filters")])}else{field_error("filters","value_error",format!("Value error, {}",e.message),&payload["filters"])})?;}
 Ok(BulkRequest{params,explicit_ids,patch,adds,removes})
}
#[cfg(test)] mod tests {use super::*;
 #[test]fn rejects_entire_patch_without_targets(){let e=validate_bulk(&json!({"filters":{},"patch":{"owner":"valid","monitoring_enabled":"maybe","tags_add":["valid",3]}})).err().unwrap();let d=e.detail.unwrap();assert_eq!(d.as_array().unwrap().len(),2);assert!(d.as_array().unwrap().iter().any(|e|e["loc"]==json!(["body","patch","tags_add",1])));}
 #[test]fn coerces_boolean_before_selection(){let r=validate_bulk(&json!({"filters":{"monitoring_enabled":"YES"},"patch":{"monitoring_enabled":1,"tags_add":[" x "]}})).unwrap();assert_eq!(r.patch,json!({"monitoring_enabled":true}));assert_eq!(r.params["monitoring_enabled"],vec!["true"]);assert_eq!(r.adds,vec![" x "]);}
 #[test]fn rejects_filter_and_tag_nulls(){assert!(validate_bulk(&json!({"filters":{"cluster":"x"},"patch":{"tags_remove":null}})).is_err());}
}
