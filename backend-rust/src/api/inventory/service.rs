use super::resource::*;
use crate::api::deps::ApiError;
use axum::http::StatusCode;
use serde_json::{json,Value};
use sqlx::{PgConnection,PgPool};
use uuid::Uuid;

pub fn db_error(e:sqlx::Error)->ApiError {if let Some(db)=e.as_database_error(){if db.code().as_deref()==Some("23505"){return ApiError::new(StatusCode::CONFLICT,if db.constraint()==Some("uq_vm_applications_vm_app"){"Application already linked to this VM"}else{"VM identity already exists"});}if [Some("23502"),Some("23514"),Some("22P02"),Some("22001")].contains(&db.code().as_deref()){return invalid(db.message());}}ApiError::internal(e.to_string())}
pub async fn row(conn:&mut PgConnection,r:Resource,id:Uuid,parent:Option<Uuid>)->Result<Value,ApiError>{let sql=if let Some((_,fk))=r.parent{format!("SELECT to_jsonb(t) FROM {} t WHERE id=$1 AND {fk}=$2",r.table)}else{format!("SELECT to_jsonb(t) FROM {} t WHERE id=$1",r.table)};let mut q=sqlx::query_scalar::<_,Value>(sqlx::AssertSqlSafe(sql)).bind(id);if r.parent.is_some(){q=q.bind(parent);}q.fetch_optional(conn).await.map_err(db_error)?.ok_or_else(||ApiError::not_found(r.missing))}
pub fn project_child(r:Resource,v:&mut Value){if r.table=="physical_nodes"{for key in ["created_at","updated_at","created_by_id","updated_by_id"]{v.as_object_mut().unwrap().remove(key);}if let Some(ips)=v["ip_addresses"].as_array_mut(){for ip in ips{if let Some(obj)=ip.as_object_mut(){obj.retain(|k,_|k=="label"||k=="address");}}}}}
pub async fn children(conn:&mut PgConnection,r:Resource,parent:Uuid)->Result<Vec<Value>,ApiError>{let (_,fk)=r.parent.unwrap();let order=if r.table=="vm_applications"{"app_name"}else{"sort_order"};let mut rows:Vec<Value>=sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT to_jsonb(t) FROM {} t WHERE {fk}=$1 ORDER BY {order}",r.table))).bind(parent).fetch_all(conn).await.map_err(db_error)?;for v in &mut rows{project_child(r,v);}Ok(rows)}
pub async fn require_parent(conn:&mut PgConnection,r:Resource,parent:Uuid)->Result<(),ApiError>{let(table,_)=r.parent.unwrap();let found:bool=sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=$1)"))).bind(parent).fetch_one(conn).await.map_err(db_error)?;if !found{return Err(ApiError::not_found(match table{"vms"=>VM.missing,"physical_clusters"=>CLUSTER.missing,"storage_arrays"=>ARRAY.missing,_=>VOLUME.missing}));}Ok(())}
pub async fn write(conn:&mut PgConnection,r:Resource,id:Option<Uuid>,parent:Option<Uuid>,payload:Value,user:Uuid)->Result<Value,ApiError>{let mut values=validate(r,payload,id.is_none())?;let obj=values.as_object_mut().unwrap();let id_value=id.unwrap_or_else(Uuid::new_v4);if id.is_none(){obj.insert("id".into(),json!(id_value));if let Some((_,fk))=r.parent{obj.insert(fk.into(),json!(parent.unwrap()));}if r.stamped{obj.insert("created_by_id".into(),json!(user));obj.insert("created_at".into(),json!(chrono::Utc::now()));}}if r.stamped{obj.insert("updated_by_id".into(),json!(user));obj.insert("updated_at".into(),json!(chrono::Utc::now()));}
 let keys:Vec<_>=obj.keys().cloned().collect();let sql=if id.is_none(){format!("INSERT INTO {} ({}) SELECT {} FROM jsonb_populate_record(NULL::{},$1) RETURNING to_jsonb({}.*)",r.table,keys.join(","),keys.join(","),r.table,r.table)}else{let assignments=keys.iter().map(|k|format!("{k}=p.{k}")).collect::<Vec<_>>().join(",");if keys.is_empty(){return row(conn,r,id_value,parent).await;}format!("UPDATE {} t SET {} FROM jsonb_populate_record(NULL::{},$1) p WHERE t.id=$2 RETURNING to_jsonb(t)",r.table,assignments,r.table)};
 let mut q=sqlx::query_scalar(sqlx::AssertSqlSafe(sql)).bind(values);if id.is_some(){q=q.bind(id_value);}q.fetch_one(conn).await.map_err(db_error)
}
pub async fn health(conn:&mut PgConnection,id:Uuid)->Result<(),ApiError>{sqlx::query("UPDATE vms v SET health_score=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements_text(tags) tag WHERE lower(btrim(tag))='template') THEN 0 ELSE (CASE WHEN coalesce(description,'')<>'' THEN 10 ELSE 0 END)+(CASE WHEN coalesce(owner,'')<>'' OR coalesce(business_owner,'')<>'' OR coalesce(technical_owner,'')<>'' THEN 15 ELSE 0 END)+(CASE WHEN EXISTS(SELECT 1 FROM vm_applications WHERE vm_id=v.id) THEN 20 ELSE 0 END)+(CASE WHEN EXISTS(SELECT 1 FROM vm_networks WHERE vm_id=v.id) THEN 15 ELSE 0 END)+(CASE WHEN EXISTS(SELECT 1 FROM vm_disks WHERE vm_id=v.id) THEN 15 ELSE 0 END)+(CASE WHEN monitoring_enabled THEN 10 ELSE 0 END)+(CASE WHEN decommission_date IS NOT NULL THEN 15 ELSE 0 END) END WHERE id=$1").bind(id).execute(conn).await.map_err(db_error)?;Ok(())}
pub async fn vm_detail(conn:&mut PgConnection,id:Uuid)->Result<Value,ApiError>{vm_details(conn,&[id]).await?.pop().ok_or_else(||ApiError::not_found(VM.missing))}
fn attach(rows:&mut [Value],key:&str,fk:&str,children:Vec<Value>){
 let mut grouped=std::collections::HashMap::<String,Vec<Value>>::new();
 for child in children{grouped.entry(child[fk].as_str().unwrap().to_owned()).or_default().push(child);}
 for row in rows{row[key]=json!(grouped.remove(row["id"].as_str().unwrap()).unwrap_or_default());}
}
async fn batch_children(conn:&mut PgConnection,r:Resource,ids:&[Uuid])->Result<Vec<Value>,ApiError>{
 let (_,fk)=r.parent.unwrap();let order=if r.table=="vm_applications"{"app_name"}else{"sort_order"};
 let mut rows:Vec<Value>=sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT to_jsonb(t) FROM {} t WHERE {fk}=ANY($1) ORDER BY {order}",r.table))).bind(ids).fetch_all(conn).await.map_err(db_error)?;
 for row in &mut rows{project_child(r,row);}Ok(rows)
}
pub async fn vm_details(conn:&mut PgConnection,ids:&[Uuid])->Result<Vec<Value>,ApiError>{
 if ids.is_empty(){return Ok(Vec::new());}
 let mut rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(v) FROM vms v WHERE id=ANY($1) ORDER BY array_position($1,id)").bind(ids).fetch_all(&mut *conn).await.map_err(db_error)?;
 for(key,r)in[("disks",DISK),("networks",NETWORK),("applications",APPLICATION)]{attach(&mut rows,key,"vm_id",batch_children(conn,r,ids).await?);}Ok(rows)
}
pub async fn parent_list(conn:&mut PgConnection,r:Resource)->Result<Vec<Value>,ApiError>{
 let sql=if r.table=="physical_clusters"{
  "SELECT jsonb_build_object('id',c.id,'name',c.name,'description',c.description,'node_count',count(n.id),'total_ram_gb',coalesce(sum(n.ram_total_gb),0),'total_storage_gb',coalesce(sum(n.storage_usable_gb),0)) FROM physical_clusters c LEFT JOIN physical_nodes n ON n.cluster_id=c.id GROUP BY c.id ORDER BY c.name"
 }else{
  "SELECT jsonb_build_object('id',a.id,'name',a.name,'vendor',a.vendor,'datacenter',a.datacenter,'total_capacity_gb',a.total_capacity_gb,'used_capacity_gb',a.used_capacity_gb,'volume_count',coalesce(v.volume_count,0),'lun_count',coalesce(l.lun_count,0),'share_count',coalesce(s.share_count,0)) FROM storage_arrays a LEFT JOIN (SELECT array_id,count(*) volume_count FROM storage_volumes GROUP BY array_id) v ON v.array_id=a.id LEFT JOIN (SELECT v.array_id,count(*) lun_count FROM storage_luns l JOIN storage_volumes v ON v.id=l.volume_id GROUP BY v.array_id) l ON l.array_id=a.id LEFT JOIN (SELECT v.array_id,count(*) share_count FROM storage_nfs_shares s JOIN storage_volumes v ON v.id=s.volume_id GROUP BY v.array_id) s ON s.array_id=a.id ORDER BY a.name"
 };
 let mut rows:Vec<Value>=sqlx::query_scalar(sql).fetch_all(&mut *conn).await.map_err(db_error)?;
 if r.table=="storage_arrays"{let warn=warn_pct(conn).await?;for row in &mut rows{capacity(row,"used_capacity_gb","total_capacity_gb",warn);}}Ok(rows)
}
pub async fn audit(conn:&mut PgConnection,id:Uuid,user:Uuid,old:&Value,new:&Value)->Result<(),ApiError>{for field in VM.fields.split_whitespace(){if old.get(field)!=new.get(field){let stringify=|v:Option<&Value>|v.filter(|v|!v.is_null()).map(|v|match v{Value::String(s)=>s.clone(),Value::Bool(b)=>if *b{"True".into()}else{"False".into()},Value::Array(a)=>format!("[{}]",a.iter().map(|v|match v{Value::String(s)=>format!("\'{}\'",s.replace("\\","\\\\").replace("\'","\\\'")),_=>v.to_string()}).collect::<Vec<_>>().join(", ")),_=>v.to_string()});sqlx::query("INSERT INTO audit_log(id,vm_id,user_id,field_name,old_value,new_value,changed_at) VALUES($1,$2,$3,$4,$5,$6,now())").bind(Uuid::new_v4()).bind(id).bind(user).bind(field).bind(stringify(old.get(field))).bind(stringify(new.get(field))).execute(&mut *conn).await.map_err(db_error)?;}}Ok(())}
pub async fn mutate_vm(pool:&PgPool,id:Option<Uuid>,payload:Value,user:Uuid)->Result<Value,ApiError>{validate_vm_request(&payload,id.is_none())?;let mut tx=pool.begin().await.map_err(db_error)?;let old=if let Some(id)=id{Some(row(&mut tx,VM,id,None).await?)}else{None};let vm=write(&mut tx,VM,id,None,payload.clone(),user).await?;let vm_id=Uuid::parse_str(vm["id"].as_str().unwrap()).unwrap();if let Some(old)=old{audit(&mut tx,vm_id,user,&old,&vm).await?;}
 for(field,r)in[("disks",DISK),("networks",NETWORK)]{if let Some(items)=payload.get(field){let items=items.as_array().ok_or_else(||invalid(format!("{field} must be an array")))?;sqlx::query(sqlx::AssertSqlSafe(format!("DELETE FROM {} WHERE vm_id=$1",r.table))).bind(vm_id).execute(&mut *tx).await.map_err(db_error)?;for item in items{write(&mut tx,r,None,Some(vm_id),item.clone(),user).await?;}}}
 health(&mut tx,vm_id).await?;let detail=vm_detail(&mut tx,vm_id).await?;tx.commit().await.map_err(db_error)?;Ok(detail)}
pub async fn delete(conn:&mut PgConnection,r:Resource,id:Uuid,parent:Option<Uuid>)->Result<(),ApiError>{row(conn,r,id,parent).await?;sqlx::query(sqlx::AssertSqlSafe(format!("DELETE FROM {} WHERE id=$1",r.table))).bind(id).execute(conn).await.map_err(db_error)?;Ok(())}
pub async fn warn_pct(conn:&mut PgConnection)->Result<i64,ApiError>{let v:Option<String>=sqlx::query_scalar("SELECT value FROM app_settings WHERE key='storage_usage_warn_pct'").fetch_optional(conn).await.map_err(db_error)?;Ok(v.and_then(|s|s.parse().ok()).unwrap_or(85))}
pub fn capacity(v:&mut Value,used:&str,total:&str,warn:i64){let cap=v[total].as_f64().unwrap_or(0.);let pct=if cap==0.{None}else{Some((v[used].as_f64().unwrap_or(0.)/cap*1000.).round_ties_even()/10.)};v["used_pct"]=json!(pct);v["over_threshold"]=json!(pct.is_some_and(|p|p>=warn as f64));}
pub async fn detail(conn:&mut PgConnection,r:Resource,id:Uuid)->Result<Value,ApiError>{
 if r.table=="vms"{return vm_detail(conn,id).await;}let mut v=row(conn,r,id,None).await?;
 if r.table=="physical_clusters"{v["nodes"]=json!(children(conn,NODE,id).await?);}
 if r.table=="storage_arrays"{
  let warn=warn_pct(conn).await?;capacity(&mut v,"used_capacity_gb","total_capacity_gb",warn);
  let mut volumes=children(conn,VOLUME,id).await?;let ids:Vec<Uuid>=volumes.iter().map(|v|Uuid::parse_str(v["id"].as_str().unwrap()).unwrap()).collect();
  attach(&mut volumes,"luns","volume_id",batch_children(conn,LUN,&ids).await?);
  attach(&mut volumes,"shares","volume_id",batch_children(conn,SHARE,&ids).await?);
  for volume in &mut volumes{capacity(volume,"used_gb","capacity_gb",warn);}v["volumes"]=json!(volumes);
 }
 for k in ["created_by_id","updated_by_id"]{v.as_object_mut().unwrap().remove(k);}Ok(v)
}
#[cfg(test)]mod projection_tests{use super::*;
 #[test]fn children_stay_with_their_parent_and_preserve_order(){let mut rows=vec![json!({"id":"b"}),json!({"id":"a"}),json!({"id":"empty"})];attach(&mut rows,"disks","vm_id",vec![json!({"vm_id":"a","sort_order":0}),json!({"vm_id":"b","sort_order":1}),json!({"vm_id":"a","sort_order":2})]);assert_eq!(rows[0]["disks"],json!([{"vm_id":"b","sort_order":1}]));assert_eq!(rows[1]["disks"],json!([{"vm_id":"a","sort_order":0},{"vm_id":"a","sort_order":2}]));assert_eq!(rows[2]["disks"],json!([]));}
 #[test]fn node_response_filters_nested_fields(){let mut node=json!({"id":"a","created_at":"hidden","ip_addresses":[{"label":"management","address":"10.0.0.1","secret":"hidden"}]});project_child(NODE,&mut node);assert_eq!(node,json!({"id":"a","ip_addresses":[{"label":"management","address":"10.0.0.1"}]}));}
}
