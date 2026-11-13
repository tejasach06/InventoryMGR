mod resource;
mod service;
mod filters;
pub(crate) mod export;
mod bulk;
use resource::*;
use service::*;
use filters::Params;
use crate::api::deps::{AppState,ApiError,Viewer,Editor,Admin,Csrf,ValidatedJson};
use axum::{Router,extract::{State,Path,Extension,RawQuery},http::StatusCode,routing::{get,post},Json};
use serde_json::{json,Value};
use sqlx::QueryBuilder;
use uuid::Uuid;
use std::collections::HashMap;
struct InventoryId(Uuid);
impl axum::extract::FromRequestParts<AppState> for InventoryId {
 type Rejection=ApiError;
 async fn from_request_parts(parts:&mut axum::http::request::Parts,state:&AppState)->Result<Self,ApiError>{
  let Path(p)=Path::<HashMap<String,String>>::from_request_parts(parts,state).await.map_err(|e|ApiError::bad_request(e.to_string()))?;
  let raw=p.get("id").unwrap();let field=parts.extensions.get::<Resource>().map(|r|r.id_field).ok_or_else(||ApiError::internal("Inventory ID route is missing resource metadata"))?;
  Uuid::parse_str(raw).map(Self).map_err(|e|uuid_validation(e,raw,field))
 }
}

#[derive(Clone, Copy)]
enum Choice { Owners, Clusters, Nodes, Applications, Tags }
#[derive(Clone, Copy)]
enum Order { Name, Requested }
enum Selection { Ids(Vec<Uuid>), All, Filtered(Order) }
pub fn router()->Router<AppState>{
 let mut router=Router::new().route("/vms",get(list_vms).post(create_vm)).route("/vms/export",get(export::export)).route("/vms/bulk",post(bulk)).route("/vms/suggestions",get(suggestions)).route("/vms/{id}/clone",post(clone_vm).layer(Extension(VM))).route("/vms/{id}",get(get_vm).patch(patch_vm).delete(delete_vm).layer(Extension(VM))).route("/vms/{id}/audit",get(audit_vm).layer(Extension(VM)));
 for(path,kind)in[("/vms/owners",Choice::Owners),("/vms/clusters",Choice::Clusters),("/vms/nodes",Choice::Nodes),("/vms/applications",Choice::Applications),("/vms/tags",Choice::Tags)]{router=router.route(path,get(choices).layer(Extension(kind)));}
 for(path,r)in[("/clusters",CLUSTER),("/storage/arrays",ARRAY)]{router=router.route(path,get(list_parents).post(create_parent).layer(Extension(r)));router=router.route(&format!("{path}/{{id}}"),get(get_parent).patch(patch_parent).delete(delete_parent).layer(Extension(r)));}
 for(path,r)in[("/vms/{parent}/disks",DISK),("/vms/{parent}/networks",NETWORK),("/vms/{parent}/applications",APPLICATION),("/clusters/{parent}/nodes",NODE),("/storage/arrays/{parent}/volumes",VOLUME),("/storage/volumes/{parent}/luns",LUN),("/storage/volumes/{parent}/shares",SHARE)]{router=router.route(path,get(list_children).post(create_child).layer(Extension(r)));router=router.route(&format!("{path}/{{id}}"),axum::routing::patch(patch_child).delete(delete_child).layer(Extension(r)));}router
}
fn identifier(p:&HashMap<String,String>,key:&str)->Result<Uuid,ApiError>{
 let field=if key=="parent"{"parent_id"}else{"item_id"};let raw=p.get(key).ok_or_else(||ApiError::validation(vec![issue(vec![json!("path"),json!(field)],"missing","Field required",&Value::Null)]))?;
 Uuid::parse_str(raw).map_err(|e|uuid_validation(e,raw,field))
}
fn uuid_validation(e:uuid::Error,raw:&str,field:&str)->ApiError{
 let message=e.to_string();let msg=if let Some((_,found))=message.split_once(", found "){format!("invalid character: found {found}")}else{message};
 let mut error=issue(vec![json!("path"),json!(field)],"uuid_parsing",format!("Input should be a valid UUID, {msg}"),&json!(raw));error["ctx"]=json!({"error":msg});ApiError::validation(vec![error])
}
async fn selected_ids(state:&AppState,p:&Params,selection:Selection)->Result<Vec<Uuid>,ApiError>{let mut b=QueryBuilder::new("SELECT v.id FROM vms v WHERE true");match &selection{Selection::Ids(ids)=>{b.push(" AND v.id IN (");let mut s=b.separated(",");for id in ids{s.push_bind(*id);}s.push_unseparated(")");},Selection::All=>{},Selection::Filtered(_)=>filters::apply(&mut b,p)?,}let ordering=match selection{Selection::Filtered(Order::Requested)=>filters::ordering(p)?,_=>"v.name ASC".into()};b.push(" ORDER BY ").push(ordering);b.build_query_scalar().fetch_all(&state.pool).await.map_err(db_error)}
fn export_selection(p: &Params) -> Result<Selection, ApiError> {
    if p.get("ids").is_some_and(|v| !v.is_empty()) {
        return Ok(Selection::Ids(
            p["ids"]
                .iter()
                .map(|id| Uuid::parse_str(id).map_err(|_| ApiError::invalid("Invalid UUID")))
                .collect::<Result<_, _>>()?,
        ));
    }
    if filters::boolean(p, "all")? == Some(true) {
        Ok(Selection::All)
    } else {
        Ok(Selection::Filtered(Order::Name))
    }
}
#[cfg(test)]
mod selection_tests {
 use super::*;
 #[test] fn export_selection_preserves_precedence_and_order(){
  assert!(matches!(export_selection(&filters::query(None)).unwrap(),Selection::Filtered(Order::Name)));
  assert!(matches!(export_selection(&filters::query(Some("all=true".into()))).unwrap(),Selection::All));
  let ids=filters::query(Some("ids=00000000-0000-0000-0000-000000000001&all=true".into()));
  assert!(matches!(export_selection(&ids).unwrap(),Selection::Ids(_)));
  assert!(export_selection(&filters::query(Some("ids=broken".into()))).is_err());
 }
}
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
async fn choices(State(s):State<AppState>,_:Viewer,Extension(kind):Extension<Choice>)->Result<Json<Value>,ApiError>{let(keep_empty,sql)=match kind{Choice::Tags=>(false,"SELECT DISTINCT jsonb_array_elements_text(tags) AS value FROM vms ORDER BY value".to_owned()),Choice::Applications=>(false,"SELECT DISTINCT app_name AS value FROM vm_applications ORDER BY value".to_owned()),Choice::Owners=>(false,"SELECT DISTINCT owner AS value FROM vms WHERE owner IS NOT NULL ORDER BY value".to_owned()),Choice::Nodes=>(false,"SELECT DISTINCT node AS value FROM vms WHERE node IS NOT NULL ORDER BY value".to_owned()),Choice::Clusters=>(true,"SELECT DISTINCT cluster AS value FROM vms WHERE cluster IS NOT NULL ORDER BY value".to_owned())};let mut vals:Vec<String>=sqlx::query_scalar(sqlx::AssertSqlSafe(sql)).fetch_all(&s.pool).await.map_err(db_error)?;if !keep_empty{vals.retain(|v|!v.is_empty());}Ok(Json(json!(vals)))}
async fn suggestions(State(s):State<AppState>,_:Viewer)->Result<Json<Value>,ApiError>{let mut v=json!({});for col in ["datacenter","os_distribution","os_version","business_owner","technical_owner","backup_location"]{let vals:Vec<String>=sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT DISTINCT {col} FROM vms WHERE {col} IS NOT NULL AND {col}<>'' ORDER BY {col}"))).fetch_all(&s.pool).await.map_err(db_error)?;v[col]=json!(vals);}Ok(Json(v))}
async fn list_parents(State(s):State<AppState>,_:Viewer,Extension(r):Extension<Resource>)->Result<Json<Value>,ApiError>{let mut c=s.pool.acquire().await.map_err(db_error)?;Ok(Json(json!(parent_list(&mut c,r).await?)))}
async fn get_parent(State(s):State<AppState>,_:Viewer,Extension(r):Extension<Resource>,InventoryId(id):InventoryId)->Result<Json<Value>,ApiError>{let mut c=s.pool.acquire().await.map_err(db_error)?;Ok(Json(detail(&mut c,r,id).await?))}
async fn create_parent(State(s):State<AppState>,u:Editor,_csrf:Csrf,Extension(r):Extension<Resource>,ValidatedJson(v):ValidatedJson<Value>)->Result<(StatusCode,Json<Value>),ApiError>{validate(r,v.clone(),true)?;let mut tx=s.pool.begin().await.map_err(db_error)?;let v=write(&mut tx,r,None,None,v,u.0.id).await?;let d=detail(&mut tx,r,Uuid::parse_str(v["id"].as_str().unwrap()).unwrap()).await?;tx.commit().await.map_err(db_error)?;Ok((StatusCode::CREATED,Json(d)))}
async fn patch_parent(State(s):State<AppState>,u:Editor,_csrf:Csrf,Extension(r):Extension<Resource>,InventoryId(id):InventoryId,ValidatedJson(v):ValidatedJson<Value>)->Result<Json<Value>,ApiError>{validate(r,v.clone(),false)?;let mut tx=s.pool.begin().await.map_err(db_error)?;row(&mut tx,r,id,None).await?;write(&mut tx,r,Some(id),None,v,u.0.id).await?;let d=detail(&mut tx,r,id).await?;tx.commit().await.map_err(db_error)?;Ok(Json(d))}
async fn delete_parent(State(s):State<AppState>,_:Editor,_csrf:Csrf,Extension(r):Extension<Resource>,InventoryId(id):InventoryId)->Result<(StatusCode,[(axum::http::HeaderName,&'static str);1]),ApiError>{let mut tx=s.pool.begin().await.map_err(db_error)?;delete(&mut tx,r,id,None).await?;tx.commit().await.map_err(db_error)?;Ok((StatusCode::NO_CONTENT,[(axum::http::header::CONTENT_TYPE,"application/json")]))}
async fn list_children(State(s):State<AppState>,_:Viewer,Extension(r):Extension<Resource>,Path(p):Path<HashMap<String,String>>)->Result<Json<Value>,ApiError>{let parent=identifier(&p,"parent")?;let mut c=s.pool.acquire().await.map_err(db_error)?;require_parent(&mut c,r,parent).await?;Ok(Json(json!(children(&mut c,r,parent).await?)))}
async fn create_child(State(s):State<AppState>,u:Editor,_csrf:Csrf,Extension(r):Extension<Resource>,Path(p):Path<HashMap<String,String>>,ValidatedJson(v):ValidatedJson<Value>)->Result<(StatusCode,Json<Value>),ApiError>{validate(r,v.clone(),true)?;let parent=identifier(&p,"parent")?;let mut tx=s.pool.begin().await.map_err(db_error)?;require_parent(&mut tx,r,parent).await?;let mut v=write(&mut tx,r,None,Some(parent),v,u.0.id).await?;if r.parent.unwrap().0=="vms"{health(&mut tx,parent).await?;}project_child(r,&mut v);tx.commit().await.map_err(db_error)?;Ok((StatusCode::CREATED,Json(v)))}
async fn patch_child(State(s):State<AppState>,u:Editor,_csrf:Csrf,Extension(r):Extension<Resource>,Path(p):Path<HashMap<String,String>>,ValidatedJson(v):ValidatedJson<Value>)->Result<Json<Value>,ApiError>{validate(r,v.clone(),false)?;let parent=identifier(&p,"parent")?;let id=identifier(&p,"id")?;let mut tx=s.pool.begin().await.map_err(db_error)?;row(&mut tx,r,id,Some(parent)).await?;let mut v=write(&mut tx,r,Some(id),Some(parent),v,u.0.id).await?;project_child(r,&mut v);tx.commit().await.map_err(db_error)?;Ok(Json(v))}
async fn delete_child(State(s):State<AppState>,_:Editor,_csrf:Csrf,Extension(r):Extension<Resource>,Path(p):Path<HashMap<String,String>>)->Result<(StatusCode,[(axum::http::HeaderName,&'static str);1]),ApiError>{let parent=identifier(&p,"parent")?;let mut tx=s.pool.begin().await.map_err(db_error)?;delete(&mut tx,r,identifier(&p,"id")?,Some(parent)).await?;if r.parent.unwrap().0=="vms"{health(&mut tx,parent).await?;}tx.commit().await.map_err(db_error)?;Ok((StatusCode::NO_CONTENT,[(axum::http::header::CONTENT_TYPE,"application/json")]))}
async fn clone_vm(State(s):State<AppState>,u:Editor,_csrf:Csrf,InventoryId(id):InventoryId)->Result<(StatusCode,Json<Value>),ApiError>{let mut tx=s.pool.begin().await.map_err(db_error)?;let mut old=vm_detail(&mut tx,id).await?;old["name"]=json!(format!("{}-copy",old["name"].as_str().unwrap()));old["external_id"]=Value::Null;let v=write(&mut tx,VM,None,None,old.clone(),u.0.id).await?;let new_id=Uuid::parse_str(v["id"].as_str().unwrap()).unwrap();for(key,r)in[("disks",DISK),("networks",NETWORK),("applications",APPLICATION)]{for child in old[key].as_array().unwrap(){write(&mut tx,r,None,Some(new_id),child.clone(),u.0.id).await?;}}health(&mut tx,new_id).await?;let v=vm_detail(&mut tx,new_id).await?;tx.commit().await.map_err(db_error)?;Ok((StatusCode::CREATED,Json(v)))}
async fn bulk(State(s):State<AppState>,u:Editor,_csrf:Csrf,ValidatedJson(payload):ValidatedJson<Value>)->Result<Json<Value>,ApiError>{
 let mut request=bulk::validate_bulk(&payload)?;request.params.insert("sort".into(),vec!["name".into()]);
 let targets=selected_ids(&s,&request.params,if request.explicit_ids{Selection::Ids(request.params["ids"].iter().map(|id|Uuid::parse_str(id).map_err(|_|ApiError::invalid("Invalid UUID"))).collect::<Result<_,_>>()?)}else{Selection::Filtered(Order::Requested)}).await?;
 if targets.len()>1000{return Err(ApiError::invalid(format!("{} VMs matched; bulk edit is limited to 1000",targets.len())));}
 let mut updated=0;let mut failed=Vec::new();
 for id in targets{
  let mut values=request.patch.clone();
  if !request.adds.is_empty()||!request.removes.is_empty(){
   let mut c=s.pool.acquire().await.map_err(db_error)?;let old=row(&mut c,VM,id,None).await?;
   let mut tags:Vec<String>=old["tags"].as_array().unwrap().iter().filter_map(Value::as_str).filter(|t|!request.removes.iter().any(|r|r.eq_ignore_ascii_case(t))).map(str::to_owned).collect();
   let existing=tags.clone();for t in &request.adds{if !existing.iter().any(|e|e.eq_ignore_ascii_case(t)){tags.push(t.clone());}}values["tags"]=json!(tags);
  }
  let outcome=match mutate_vm(&s.pool,Some(id),values,u.0.id).await{Ok(_)=>if request.app_adds.is_empty()&&request.app_removes.is_empty(){Ok(())}else{bulk_applications(&s.pool,id,&request.app_adds,&request.app_removes).await},Err(e)=>Err(e)};
  match outcome{Ok(())=>updated+=1,Err(e)=>failed.push(json!({"id":id,"message":if e.message.is_empty(){e.detail.map(|v|v.to_string()).unwrap_or_default()}else{e.message}}))}
 }
 Ok(Json(json!({"updated":updated,"failed":failed})))
}
async fn audit_vm(State(s):State<AppState>,_:Viewer,InventoryId(id):InventoryId,RawQuery(raw):RawQuery)->Result<Json<Value>,ApiError>{
 let p=filters::query(raw);let limit=filters::bounded(&p,"limit",50,1,Some(200))?;let offset=filters::bounded(&p,"offset",0,0,None)?;
 let mut c=s.pool.acquire().await.map_err(db_error)?;row(&mut c,VM,id,None).await?;
 let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(a)||jsonb_build_object('user',CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id',u.id,'email',u.email) END) FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.vm_id=$1 ORDER BY a.changed_at DESC LIMIT $2 OFFSET $3").bind(id).bind(limit).bind(offset).fetch_all(&mut *c).await.map_err(db_error)?;
 Ok(Json(json!(rows)))
}
