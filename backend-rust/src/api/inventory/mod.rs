mod resource;
mod service;
mod filters;
mod export;
mod bulk;
use resource::*;
use service::*;
use filters::Params;
use crate::api::deps::{AppState,ApiError,Viewer,Editor,Admin,Csrf,ValidatedJson};
use axum::{Router,extract::{State,Path,OriginalUri,RawQuery},http::StatusCode,routing::{get,post},Json};
use serde_json::{json,Value};
use sqlx::QueryBuilder;
use uuid::Uuid;
use std::collections::HashMap;
struct InventoryId(Uuid);
impl axum::extract::FromRequestParts<AppState> for InventoryId {
 type Rejection=ApiError;
 async fn from_request_parts(parts:&mut axum::http::request::Parts,state:&AppState)->Result<Self,ApiError>{
  let Path(p)=Path::<HashMap<String,String>>::from_request_parts(parts,state).await.map_err(|e|ApiError::bad_request(e.to_string()))?;
  let raw=p.get("id").unwrap();let field=if parts.uri.path().contains("/vms/"){"vm_id"}else if parts.uri.path().contains("/clusters/"){"cluster_id"}else{"array_id"};
  Uuid::parse_str(raw).map(Self).map_err(|e|uuid_validation(e,raw,field))
 }
}

pub fn router()->Router<AppState>{let mut router=Router::new().route("/vms",get(list_vms).post(create_vm)).route("/vms/export",get(export::export)).route("/vms/bulk",post(bulk)).route("/vms/suggestions",get(suggestions)).route("/vms/{id}/clone",post(clone_vm)).route("/vms/{id}",get(get_vm).patch(patch_vm).delete(delete_vm));
 router=router.route("/vms/{id}/audit",get(audit_vm));
 for path in ["/vms/owners","/vms/clusters","/vms/nodes","/vms/applications","/vms/tags"]{router=router.route(path,get(choices));}
 for path in ["/clusters","/storage/arrays"]{router=router.route(path,get(list_parents).post(create_parent));}
 for path in ["/clusters/{id}","/storage/arrays/{id}"]{router=router.route(path,get(get_parent).patch(patch_parent).delete(delete_parent));}
 for path in ["/vms/{parent}/disks","/vms/{parent}/networks","/vms/{parent}/applications","/clusters/{parent}/nodes","/storage/arrays/{parent}/volumes","/storage/volumes/{parent}/luns","/storage/volumes/{parent}/shares"]{router=router.route(path,get(list_children).post(create_child));router=router.route(&format!("{path}/{{id}}"),axum::routing::patch(patch_child).delete(delete_child));}router}
fn resource(uri:&axum::http::Uri)->Resource{let p=uri.path();if p.contains("/disks"){DISK}else if p.contains("/networks"){NETWORK}else if p.contains("/applications"){APPLICATION}else if p.contains("/nodes"){NODE}else if p.contains("/luns"){LUN}else if p.contains("/shares"){SHARE}else if p.contains("/volumes"){VOLUME}else if p.contains("/storage/"){ARRAY}else{CLUSTER}}
fn identifier(p:&HashMap<String,String>,key:&str)->Result<Uuid,ApiError>{
 let field=if key=="parent"{"parent_id"}else{"item_id"};let raw=p.get(key).ok_or_else(||ApiError::validation(vec![issue(vec![json!("path"),json!(field)],"missing","Field required",&Value::Null)]))?;
 Uuid::parse_str(raw).map_err(|e|uuid_validation(e,raw,field))
}
fn uuid_validation(e:uuid::Error,raw:&str,field:&str)->ApiError{
 let message=e.to_string();let mut msg=if let Some((_,found))=message.split_once(", found "){format!("invalid character: found {found}")}else{message};
 if msg.starts_with("invalid character:"){if let Some((prefix,index))=msg.rsplit_once(" at "){if let Ok(index)=index.parse::<usize>(){msg=format!("{prefix} at {}",index+1);}}}
 let mut error=issue(vec![json!("path"),json!(field)],"uuid_parsing",format!("Input should be a valid UUID, {msg}"),&json!(raw));error["ctx"]=json!({"error":msg});ApiError::validation(vec![error])
}
#[cfg(test)]mod uuid_tests{use super::*;#[test]fn uuid_error_character_position_matches_pydantic(){let e=uuid_validation(Uuid::parse_str("not-a-uuid").unwrap_err(),"not-a-uuid","vm_id");let detail=e.detail.unwrap();assert_eq!(detail[0]["ctx"]["error"],"invalid character: found `n` at 1");assert_eq!(detail[0]["loc"],json!(["path","vm_id"]));}}
pub async fn selected_ids(state:&AppState,p:&Params,export:bool)->Result<Vec<Uuid>,ApiError>{let mut b=QueryBuilder::new("SELECT v.id FROM vms v WHERE true");if export && p.get("ids").is_some_and(|v|!v.is_empty()){b.push(" AND v.id IN (");let mut s=b.separated(",");for id in &p["ids"]{s.push_bind(Uuid::parse_str(id).map_err(|_|invalid("Invalid UUID"))?);}s.push_unseparated(")");}else if !(export && filters::boolean(p,"all")?==Some(true)){filters::apply(&mut b,p)?;}b.push(" ORDER BY ").push(if export{"v.name ASC".into()}else{filters::ordering(p)?});b.build_query_scalar().fetch_all(&state.pool).await.map_err(db_error)}
async fn list_vms(State(s):State<AppState>,_:Viewer,RawQuery(raw):RawQuery)->Result<Json<Value>,ApiError>{
 let p=filters::query(raw);filters::validate_query(&p)?;
 let limit=filters::bounded(&p,"limit",50,1,Some(200))?;let offset=filters::bounded(&p,"offset",0,0,None)?;
 let mut count=QueryBuilder::new("SELECT count(*) FROM vms v WHERE true");filters::apply(&mut count,&p)?;let total:i64=count.build_query_scalar().fetch_one(&s.pool).await.map_err(db_error)?;
 let mut b=QueryBuilder::new("SELECT v.id FROM vms v WHERE true");filters::apply(&mut b,&p)?;b.push(" ORDER BY ").push(filters::ordering(&p)?).push(" LIMIT ").push_bind(limit).push(" OFFSET ").push_bind(offset);
 let ids:Vec<Uuid>=b.build_query_scalar().fetch_all(&s.pool).await.map_err(db_error)?;let mut conn=s.pool.acquire().await.map_err(db_error)?;let items=vm_details(&mut conn,&ids).await?;
 Ok(Json(json!({"items":items,"total":total,"limit":limit,"offset":offset})))
}
async fn create_vm(State(s):State<AppState>,u:Editor,_csrf:Csrf,ValidatedJson(v):ValidatedJson<Value>)->Result<(StatusCode,Json<Value>),ApiError>{Ok((StatusCode::CREATED,Json(mutate_vm(&s.pool,None,v,u.0.id).await?)))}
async fn patch_vm(State(s):State<AppState>,u:Editor,_csrf:Csrf,InventoryId(id):InventoryId,ValidatedJson(v):ValidatedJson<Value>)->Result<Json<Value>,ApiError>{Ok(Json(mutate_vm(&s.pool,Some(id),v,u.0.id).await?))}
async fn get_vm(State(s):State<AppState>,_:Viewer,InventoryId(id):InventoryId)->Result<Json<Value>,ApiError>{let mut c=s.pool.acquire().await.map_err(db_error)?;Ok(Json(vm_detail(&mut c,id).await?))}
async fn delete_vm(State(s):State<AppState>,_:Admin,_csrf:Csrf,InventoryId(id):InventoryId)->Result<(StatusCode,[(axum::http::HeaderName,&'static str);1]),ApiError>{let mut tx=s.pool.begin().await.map_err(db_error)?;delete(&mut tx,VM,id,None).await?;tx.commit().await.map_err(db_error)?;Ok((StatusCode::NO_CONTENT,[(axum::http::header::CONTENT_TYPE,"application/json")]))}
async fn choices(State(s):State<AppState>,_:Viewer,OriginalUri(uri):OriginalUri)->Result<Json<Value>,ApiError>{let kind=uri.path().rsplit('/').next().unwrap();let sql=match kind{"tags"=>"SELECT DISTINCT jsonb_array_elements_text(tags) AS value FROM vms ORDER BY value".to_owned(),"applications"=>"SELECT DISTINCT app_name AS value FROM vm_applications ORDER BY value".to_owned(),_=>{let col=match kind{"owners"=>"owner","nodes"=>"node",_=>"cluster"};format!("SELECT DISTINCT {col} AS value FROM vms WHERE {col} IS NOT NULL ORDER BY value")}};let mut vals:Vec<String>=sqlx::query_scalar(sqlx::AssertSqlSafe(sql)).fetch_all(&s.pool).await.map_err(db_error)?;if kind!="clusters"{vals.retain(|v|!v.is_empty());}Ok(Json(json!(vals)))}
async fn suggestions(State(s):State<AppState>,_:Viewer)->Result<Json<Value>,ApiError>{let mut v=json!({});for col in ["datacenter","os_distribution","os_version","business_owner","technical_owner","backup_location"]{let vals:Vec<String>=sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT DISTINCT {col} FROM vms WHERE {col} IS NOT NULL AND {col}<>'' ORDER BY {col}"))).fetch_all(&s.pool).await.map_err(db_error)?;v[col]=json!(vals);}Ok(Json(v))}
async fn list_parents(State(s):State<AppState>,_:Viewer,OriginalUri(uri):OriginalUri)->Result<Json<Value>,ApiError>{let mut c=s.pool.acquire().await.map_err(db_error)?;Ok(Json(json!(parent_list(&mut c,resource(&uri)).await?)))}
async fn get_parent(State(s):State<AppState>,_:Viewer,OriginalUri(uri):OriginalUri,InventoryId(id):InventoryId)->Result<Json<Value>,ApiError>{let mut c=s.pool.acquire().await.map_err(db_error)?;Ok(Json(detail(&mut c,resource(&uri),id).await?))}
async fn create_parent(State(s):State<AppState>,u:Editor,_csrf:Csrf,OriginalUri(uri):OriginalUri,ValidatedJson(v):ValidatedJson<Value>)->Result<(StatusCode,Json<Value>),ApiError>{let r=resource(&uri);validate(r,v.clone(),true)?;let mut tx=s.pool.begin().await.map_err(db_error)?;let v=write(&mut tx,r,None,None,v,u.0.id).await?;let d=detail(&mut tx,r,Uuid::parse_str(v["id"].as_str().unwrap()).unwrap()).await?;tx.commit().await.map_err(db_error)?;Ok((StatusCode::CREATED,Json(d)))}
async fn patch_parent(State(s):State<AppState>,u:Editor,_csrf:Csrf,OriginalUri(uri):OriginalUri,InventoryId(id):InventoryId,ValidatedJson(v):ValidatedJson<Value>)->Result<Json<Value>,ApiError>{let r=resource(&uri);validate(r,v.clone(),false)?;let mut tx=s.pool.begin().await.map_err(db_error)?;row(&mut tx,r,id,None).await?;write(&mut tx,r,Some(id),None,v,u.0.id).await?;let d=detail(&mut tx,r,id).await?;tx.commit().await.map_err(db_error)?;Ok(Json(d))}
async fn delete_parent(State(s):State<AppState>,_:Editor,_csrf:Csrf,OriginalUri(uri):OriginalUri,InventoryId(id):InventoryId)->Result<(StatusCode,[(axum::http::HeaderName,&'static str);1]),ApiError>{let mut tx=s.pool.begin().await.map_err(db_error)?;delete(&mut tx,resource(&uri),id,None).await?;tx.commit().await.map_err(db_error)?;Ok((StatusCode::NO_CONTENT,[(axum::http::header::CONTENT_TYPE,"application/json")]))}
async fn list_children(State(s):State<AppState>,_:Viewer,OriginalUri(uri):OriginalUri,Path(p):Path<HashMap<String,String>>)->Result<Json<Value>,ApiError>{let r=resource(&uri);let parent=identifier(&p,"parent")?;let mut c=s.pool.acquire().await.map_err(db_error)?;require_parent(&mut c,r,parent).await?;Ok(Json(json!(children(&mut c,r,parent).await?)))}
async fn create_child(State(s):State<AppState>,u:Editor,_csrf:Csrf,OriginalUri(uri):OriginalUri,Path(p):Path<HashMap<String,String>>,ValidatedJson(v):ValidatedJson<Value>)->Result<(StatusCode,Json<Value>),ApiError>{let r=resource(&uri);validate(r,v.clone(),true)?;let parent=identifier(&p,"parent")?;let mut tx=s.pool.begin().await.map_err(db_error)?;require_parent(&mut tx,r,parent).await?;let mut v=write(&mut tx,r,None,Some(parent),v,u.0.id).await?;if r.parent.unwrap().0=="vms"{health(&mut tx,parent).await?;}project_child(r,&mut v);tx.commit().await.map_err(db_error)?;Ok((StatusCode::CREATED,Json(v)))}
async fn patch_child(State(s):State<AppState>,u:Editor,_csrf:Csrf,OriginalUri(uri):OriginalUri,Path(p):Path<HashMap<String,String>>,ValidatedJson(v):ValidatedJson<Value>)->Result<Json<Value>,ApiError>{let r=resource(&uri);validate(r,v.clone(),false)?;let parent=identifier(&p,"parent")?;let id=identifier(&p,"id")?;let mut tx=s.pool.begin().await.map_err(db_error)?;row(&mut tx,r,id,Some(parent)).await?;let mut v=write(&mut tx,r,Some(id),Some(parent),v,u.0.id).await?;project_child(r,&mut v);tx.commit().await.map_err(db_error)?;Ok(Json(v))}
async fn delete_child(State(s):State<AppState>,_:Editor,_csrf:Csrf,OriginalUri(uri):OriginalUri,Path(p):Path<HashMap<String,String>>)->Result<(StatusCode,[(axum::http::HeaderName,&'static str);1]),ApiError>{let r=resource(&uri);let parent=identifier(&p,"parent")?;let mut tx=s.pool.begin().await.map_err(db_error)?;delete(&mut tx,r,identifier(&p,"id")?,Some(parent)).await?;if r.parent.unwrap().0=="vms"{health(&mut tx,parent).await?;}tx.commit().await.map_err(db_error)?;Ok((StatusCode::NO_CONTENT,[(axum::http::header::CONTENT_TYPE,"application/json")]))}
async fn clone_vm(State(s):State<AppState>,u:Editor,_csrf:Csrf,InventoryId(id):InventoryId)->Result<(StatusCode,Json<Value>),ApiError>{let mut tx=s.pool.begin().await.map_err(db_error)?;let mut old=vm_detail(&mut tx,id).await?;old["name"]=json!(format!("{}-copy",old["name"].as_str().unwrap()));old["external_id"]=Value::Null;let v=write(&mut tx,VM,None,None,old.clone(),u.0.id).await?;let new_id=Uuid::parse_str(v["id"].as_str().unwrap()).unwrap();for(key,r)in[("disks",DISK),("networks",NETWORK),("applications",APPLICATION)]{for child in old[key].as_array().unwrap(){write(&mut tx,r,None,Some(new_id),child.clone(),u.0.id).await?;}}health(&mut tx,new_id).await?;let v=vm_detail(&mut tx,new_id).await?;tx.commit().await.map_err(db_error)?;Ok((StatusCode::CREATED,Json(v)))}
async fn bulk(State(s):State<AppState>,u:Editor,_csrf:Csrf,ValidatedJson(payload):ValidatedJson<Value>)->Result<Json<Value>,ApiError>{
 let mut request=bulk::validate_bulk(&payload)?;request.params.insert("sort".into(),vec!["name".into()]);
 let targets=selected_ids(&s,&request.params,request.explicit_ids).await?;
 if targets.len()>1000{return Err(invalid(format!("{} VMs matched; bulk edit is limited to 1000",targets.len())));}
 let mut updated=0;let mut failed=Vec::new();
 for id in targets{
  let mut values=request.patch.clone();
  if !request.adds.is_empty()||!request.removes.is_empty(){
   let mut c=s.pool.acquire().await.map_err(db_error)?;let old=row(&mut c,VM,id,None).await?;
   let mut tags:Vec<String>=old["tags"].as_array().unwrap().iter().filter_map(Value::as_str).filter(|t|!request.removes.iter().any(|r|r.eq_ignore_ascii_case(t))).map(str::to_owned).collect();
   let existing=tags.clone();for t in &request.adds{if !existing.iter().any(|e|e.eq_ignore_ascii_case(t)){tags.push(t.clone());}}values["tags"]=json!(tags);
  }
  match mutate_vm(&s.pool,Some(id),values,u.0.id).await{Ok(_)=>updated+=1,Err(e)=>failed.push(json!({"id":id,"message":if e.message.is_empty(){e.detail.map(|v|v.to_string()).unwrap_or_default()}else{e.message}}))}
 }
 Ok(Json(json!({"updated":updated,"failed":failed})))
}
async fn audit_vm(State(s):State<AppState>,_:Viewer,InventoryId(id):InventoryId,RawQuery(raw):RawQuery)->Result<Json<Value>,ApiError>{
 let p=filters::query(raw);let limit=filters::bounded(&p,"limit",50,1,Some(200))?;let offset=filters::bounded(&p,"offset",0,0,None)?;
 let mut c=s.pool.acquire().await.map_err(db_error)?;row(&mut c,VM,id,None).await?;
 let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(a)||jsonb_build_object('user',CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id',u.id,'email',u.email) END) FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.vm_id=$1 ORDER BY a.changed_at DESC LIMIT $2 OFFSET $3").bind(id).bind(limit).bind(offset).fetch_all(&mut *c).await.map_err(db_error)?;
 Ok(Json(json!(rows)))
}
