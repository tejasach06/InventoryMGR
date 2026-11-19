use super::resource::*;
use crate::api::deps::ApiError;
use axum::http::StatusCode;
use serde_json::{json,Value};
use sqlx::{PgConnection,PgPool};
use uuid::Uuid;

pub fn db_error(e:sqlx::Error)->ApiError {if let Some(db)=e.as_database_error(){if db.code().as_deref()==Some("23505"){return ApiError::new(StatusCode::CONFLICT,if db.constraint()==Some("uq_vm_applications_vm_app"){"Application already linked to this VM"}else{"VM identity already exists"});}if [Some("23502"),Some("23514"),Some("22P02"),Some("22001")].contains(&db.code().as_deref()){return ApiError::invalid(db.message());}}ApiError::internal(e.to_string())}
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
 for(key,r)in[("disks",DISK),("networks",NETWORK),("applications",APPLICATION)]{attach(&mut rows,key,"vm_id",batch_children(conn,r,ids).await?);}
 let mut mappings = batch_ip_mappings(conn, ids).await?;
 for row in &mut rows {
  let vm_id = row["id"].as_str().unwrap();
  row["ip_mappings"] = json!(mappings.remove(vm_id).unwrap_or_default());
  let nets = row["networks"].as_array().cloned().unwrap_or_default();
  let maps = row["ip_mappings"].as_array().cloned().unwrap_or_default();
  let token = compute_network_precondition(&nets, &maps);
  row["network_precondition"] = json!(token);
  row["mapping_precondition"] = json!(token);
 }
 Ok(rows)
}

pub fn compute_network_precondition(networks: &[Value], ip_mappings: &[Value]) -> String {
 use sha2::{Digest, Sha256};
 let mut hasher = Sha256::new();

 let mut sorted_nets: Vec<&Value> = networks.iter().collect();
 sorted_nets.sort_by(|a, b| {
  let a_order = a.get("sort_order").and_then(Value::as_i64).unwrap_or(0);
  let b_order = b.get("sort_order").and_then(Value::as_i64).unwrap_or(0);
  let a_id = a.get("id").and_then(Value::as_str).unwrap_or("");
  let b_id = b.get("id").and_then(Value::as_str).unwrap_or("");
  a_order.cmp(&b_order).then_with(|| a_id.cmp(b_id))
 });

 for n in sorted_nets {
  let id = n.get("id").and_then(Value::as_str).unwrap_or("");
  let sort_order = n.get("sort_order").and_then(Value::as_i64).unwrap_or(0);
  let role = n.get("role").and_then(Value::as_str).unwrap_or("");
  let ip = crate::core::ip_utils::normalize_ip(n.get("ip_address").and_then(Value::as_str).unwrap_or(""));
  hasher.update(format!("{id}:{sort_order}:{role}:{ip}\n").as_bytes());
 }

 hasher.update(b"---\n");

 let mut sorted_maps: Vec<&Value> = ip_mappings.iter().collect();
 sorted_maps.sort_by(|a, b| {
  let a_pub = a.get("public_ip").and_then(Value::as_str).unwrap_or("");
  let b_pub = b.get("public_ip").and_then(Value::as_str).unwrap_or("");
  let a_priv = a.get("private_ip").and_then(Value::as_str).unwrap_or("");
  let b_priv = b.get("private_ip").and_then(Value::as_str).unwrap_or("");
  let a_pub_norm = crate::core::ip_utils::normalize_ip(a_pub);
  let b_pub_norm = crate::core::ip_utils::normalize_ip(b_pub);
  let a_priv_norm = crate::core::ip_utils::normalize_ip(a_priv);
  let b_priv_norm = crate::core::ip_utils::normalize_ip(b_priv);
  a_pub_norm.cmp(b_pub_norm).then_with(|| a_priv_norm.cmp(b_priv_norm))
 });

 for m in sorted_maps {
  let pub_ip = crate::core::ip_utils::normalize_ip(m.get("public_ip").and_then(Value::as_str).unwrap_or(""));
  let priv_ip = crate::core::ip_utils::normalize_ip(m.get("private_ip").and_then(Value::as_str).unwrap_or(""));
  hasher.update(format!("{pub_ip}>{priv_ip}\n").as_bytes());
 }

 hex::encode(hasher.finalize())
}
async fn batch_ip_mappings(conn:&mut PgConnection, ids:&[Uuid])->Result<std::collections::HashMap<String, Vec<Value>>, ApiError> {
 if ids.is_empty(){return Ok(std::collections::HashMap::new());}
 let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
  "SELECT m.vm_id, pub.ip_address, priv.ip_address
   FROM vm_ip_mappings m
   JOIN vm_networks pub ON pub.id = m.public_ip_id
   JOIN vm_networks priv ON priv.id = m.private_ip_id
   WHERE m.vm_id = ANY($1)
   ORDER BY pub.ip_address ASC, priv.ip_address ASC, m.id ASC"
 )
 .bind(ids)
 .fetch_all(&mut *conn)
 .await
 .map_err(db_error)?;

 let mut grouped = std::collections::HashMap::<String, Vec<Value>>::new();
 for (vm_id, pub_ip, priv_ip) in rows {
  grouped.entry(vm_id.to_string()).or_default().push(json!({
   "public_ip": pub_ip,
   "private_ip": priv_ip,
  }));
 }
 Ok(grouped)
}
#[derive(sqlx::FromRow)]
struct NetworkRow {
 id: Uuid,
 ip_address: String,
 role: String,
}
pub async fn lock_vm(conn: &mut PgConnection, id: Uuid) -> Result<(), ApiError> {
 sqlx::query("SELECT id FROM vms WHERE id=$1 FOR UPDATE")
  .bind(id)
  .fetch_optional(&mut *conn)
  .await
  .map_err(db_error)?
  .ok_or_else(|| ApiError::not_found(VM.missing))?;
 Ok(())
}
pub async fn fetch_vm_mapping_pairs(conn: &mut PgConnection, vm_id: Uuid) -> Result<Vec<(String, String)>, ApiError> {
 sqlx::query_as(
  "SELECT pub.ip_address, priv.ip_address
   FROM vm_ip_mappings m
   JOIN vm_networks pub ON pub.id = m.public_ip_id
   JOIN vm_networks priv ON priv.id = m.private_ip_id
   WHERE m.vm_id = $1
   ORDER BY pub.ip_address ASC, priv.ip_address ASC, m.id ASC"
 )
 .bind(vm_id)
 .fetch_all(conn)
 .await
 .map_err(db_error)
}
pub fn canonical_mappings_string(pairs: &[(String, String)]) -> Option<String> {
 if pairs.is_empty() {
  None
 } else {
  let mut sorted: Vec<String> = pairs.iter().map(|(pub_ip, priv_ip)| format!("{pub_ip}>{priv_ip}")).collect();
  sorted.sort();
  Some(sorted.join(";"))
 }
}

pub async fn audit_ip_mappings(
 conn: &mut PgConnection,
 vm_id: Uuid,
 user_id: Uuid,
 before: &[(String, String)],
 after: &[(String, String)],
) -> Result<(), ApiError> {
 let old_canonical = canonical_mappings_string(before);
 let new_canonical = canonical_mappings_string(after);
 if old_canonical != new_canonical {
  sqlx::query(
   "INSERT INTO audit_log (id, vm_id, user_id, field_name, old_value, new_value, changed_at)
    VALUES ($1, $2, $3, 'ip_mappings', $4, $5, now())"
  )
  .bind(Uuid::new_v4())
  .bind(vm_id)
  .bind(user_id)
  .bind(old_canonical)
  .bind(new_canonical)
  .execute(&mut *conn)
  .await
  .map_err(db_error)?;
 }
 Ok(())
}

pub async fn apply_ip_mappings(conn: &mut PgConnection, vm_id: Uuid, mappings: &[Value]) -> Result<(), ApiError> {
 let networks: Vec<NetworkRow> = sqlx::query_as(
  "SELECT id, ip_address, role::text FROM vm_networks WHERE vm_id = $1"
 )
 .bind(vm_id)
 .fetch_all(&mut *conn)
 .await
 .map_err(db_error)?;

 let mut ip_to_networks: std::collections::HashMap<String, Vec<(&str, Uuid)>> = std::collections::HashMap::new();
 for n in &networks {
  let norm = crate::core::ip_utils::normalize_ip(&n.ip_address).to_string();
  ip_to_networks.entry(norm).or_default().push((&n.role, n.id));
 }

 let mut errors = Vec::new();
 let mut pairs = Vec::new();
 let mut seen = std::collections::HashSet::new();

 for (index, item) in mappings.iter().enumerate() {
  let pub_raw = item.get("public_ip").and_then(Value::as_str).unwrap_or("");
  let priv_raw = item.get("private_ip").and_then(Value::as_str).unwrap_or("");
  let pub_norm = crate::core::ip_utils::normalize_ip(pub_raw).to_string();
  let priv_norm = crate::core::ip_utils::normalize_ip(priv_raw).to_string();

  let mut pub_id = None;
  let pub_entries = ip_to_networks.get(&pub_norm);
  match pub_entries {
   None => {
    errors.push(issue(
     vec![json!("body"), json!("ip_mappings"), json!(index), json!("public_ip")],
     "value_error",
     format!("Address '{pub_raw}' does not match any network entry on this VM"),
     &item["public_ip"],
    ));
   }
   Some(entries) => {
    let pub_roles: Vec<_> = entries.iter().filter(|(role, _)| *role == "public").collect();
    if pub_roles.is_empty() {
     let actual = entries[0].0;
     errors.push(issue(
      vec![json!("body"), json!("ip_mappings"), json!(index), json!("public_ip")],
      "value_error",
      format!("Network entry '{pub_raw}' has role '{actual}', expected 'public'"),
      &item["public_ip"],
     ));
    } else if pub_roles.len() > 1 {
     errors.push(issue(
      vec![json!("body"), json!("ip_mappings"), json!(index), json!("public_ip")],
      "value_error",
      format!("Ambiguous public address '{pub_raw}'; multiple matching network entries found"),
      &item["public_ip"],
     ));
    } else {
     pub_id = Some(pub_roles[0].1);
    }
   }
  }

  let mut priv_id = None;
  let priv_entries = ip_to_networks.get(&priv_norm);
  match priv_entries {
   None => {
    errors.push(issue(
     vec![json!("body"), json!("ip_mappings"), json!(index), json!("private_ip")],
     "value_error",
     format!("Address '{priv_raw}' does not match any network entry on this VM"),
     &item["private_ip"],
    ));
   }
   Some(entries) => {
    let priv_roles: Vec<_> = entries.iter().filter(|(role, _)| *role == "private").collect();
    if priv_roles.is_empty() {
     let actual = entries[0].0;
     errors.push(issue(
      vec![json!("body"), json!("ip_mappings"), json!(index), json!("private_ip")],
      "value_error",
      format!("Network entry '{priv_raw}' has role '{actual}', expected 'private'"),
      &item["private_ip"],
     ));
    } else if priv_roles.len() > 1 {
     errors.push(issue(
      vec![json!("body"), json!("ip_mappings"), json!(index), json!("private_ip")],
      "value_error",
      format!("Ambiguous private address '{priv_raw}'; multiple matching network entries found"),
      &item["private_ip"],
     ));
    } else {
     priv_id = Some(priv_roles[0].1);
    }
   }
  }

  if let (Some(pub_id), Some(priv_id)) = (pub_id, priv_id) {
   if seen.insert((pub_id, priv_id)) {
    pairs.push((pub_id, priv_id));
   }
  }
 }

 if !errors.is_empty() {
  if errors.len() > 100 {
   errors.truncate(100);
  }
  return Err(ApiError::validation(errors));
 }

 if !pairs.is_empty() {
  let mut builder = sqlx::QueryBuilder::new(
   "INSERT INTO vm_ip_mappings (id, vm_id, public_ip_id, public_role, private_ip_id, private_role) "
  );
  builder.push_values(pairs, |mut b, (pub_id, priv_id)| {
   b.push_bind(Uuid::new_v4())
    .push_bind(vm_id)
    .push_bind(pub_id)
    .push(" 'public' ")
    .push_bind(priv_id)
    .push(" 'private' ");
  });
  builder.build().execute(&mut *conn).await.map_err(db_error)?;
 }

 Ok(())
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
pub async fn mutate_vm(pool:&PgPool,id:Option<Uuid>,payload:Value,user:Uuid)->Result<Value,ApiError>{
 validate_vm_request(&payload,id.is_none())?;
 let mut tx=pool.begin().await.map_err(db_error)?;
 let old=if let Some(id)=id{
  lock_vm(&mut tx, id).await?;
  let old_row: Value = sqlx::query_scalar("SELECT to_jsonb(v) FROM vms v WHERE id=$1")
   .bind(id)
   .fetch_optional(&mut *tx)
   .await
   .map_err(db_error)?
   .ok_or_else(|| ApiError::not_found(VM.missing))?;

  if payload.get("ip_mappings").is_some() {
   let current_nets = children(&mut tx, NETWORK, id).await?;
   let mut current_map_map = batch_ip_mappings(&mut tx, &[id]).await?;
   let current_maps = current_map_map.remove(&id.to_string()).unwrap_or_default();
   let current_token = compute_network_precondition(&current_nets, &current_maps);

   let client_token = payload
    .get("network_precondition")
    .or_else(|| payload.get("mapping_precondition"))
    .and_then(Value::as_str);

   if client_token != Some(current_token.as_str()) {
    return Err(ApiError::conflict(
     "Network configuration has changed since loading; reload the VM to view current networks and mappings before editing",
    ));
   }
  }

  Some(old_row)
 }else{None};
 let vm=write(&mut tx,VM,id,None,payload.clone(),user).await?;
 let vm_id=Uuid::parse_str(vm["id"].as_str().unwrap()).unwrap();
 if let Some(old)=old{audit(&mut tx,vm_id,user,&old,&vm).await?;}

 let before_pairs = if id.is_some() {
  fetch_vm_mapping_pairs(&mut tx, vm_id).await?
 } else {
  Vec::new()
 };

 if let Some(disks)=payload.get("disks"){
  let items=disks.as_array().ok_or_else(||ApiError::invalid("disks must be an array"))?;
  sqlx::query(sqlx::AssertSqlSafe(format!("DELETE FROM {} WHERE vm_id=$1",DISK.table))).bind(vm_id).execute(&mut *tx).await.map_err(db_error)?;
  for item in items{write(&mut tx,DISK,None,Some(vm_id),item.clone(),user).await?;}
 }

 let has_networks = payload.get("networks").is_some();
 let mappings_opt = payload.get("ip_mappings");

 if let Some(mappings) = mappings_opt {
  let mapping_items = mappings.as_array().ok_or_else(|| ApiError::invalid("ip_mappings must be an array"))?;
  if has_networks {
   let net_items = payload["networks"].as_array().unwrap();
   sqlx::query("DELETE FROM vm_ip_mappings WHERE vm_id=$1").bind(vm_id).execute(&mut *tx).await.map_err(db_error)?;
   sqlx::query("DELETE FROM vm_networks WHERE vm_id=$1").bind(vm_id).execute(&mut *tx).await.map_err(db_error)?;
   for item in net_items {
    write(&mut tx, NETWORK, None, Some(vm_id), item.clone(), user).await?;
   }
  } else {
   sqlx::query("DELETE FROM vm_ip_mappings WHERE vm_id=$1").bind(vm_id).execute(&mut *tx).await.map_err(db_error)?;
  }
  apply_ip_mappings(&mut tx, vm_id, mapping_items).await?;
 } else if has_networks {
  let net_items = payload["networks"].as_array().unwrap();
  let existing_pairs = &before_pairs;

  if !existing_pairs.is_empty() {
   for (pub_ip, priv_ip) in existing_pairs {
    let norm_pub = crate::core::ip_utils::normalize_ip(pub_ip);
    let norm_priv = crate::core::ip_utils::normalize_ip(priv_ip);

    let pub_match_count = net_items.iter().filter(|n| {
     let ip = n.get("ip_address").and_then(Value::as_str).unwrap_or("");
     let role = n.get("role").and_then(Value::as_str).unwrap_or("private");
     crate::core::ip_utils::normalize_ip(ip) == norm_pub && role == "public"
    }).count();

    let priv_match_count = net_items.iter().filter(|n| {
     let ip = n.get("ip_address").and_then(Value::as_str).unwrap_or("");
     let role = n.get("role").and_then(Value::as_str).unwrap_or("private");
     crate::core::ip_utils::normalize_ip(ip) == norm_priv && role == "private"
    }).count();

    if pub_match_count != 1 || priv_match_count != 1 {
     return Err(ApiError::conflict("Cannot replace networks: existing IP mapping would be invalidated; update or clear ip_mappings first"));
    }
   }
  }

  sqlx::query("DELETE FROM vm_ip_mappings WHERE vm_id=$1").bind(vm_id).execute(&mut *tx).await.map_err(db_error)?;
  sqlx::query("DELETE FROM vm_networks WHERE vm_id=$1").bind(vm_id).execute(&mut *tx).await.map_err(db_error)?;
  for item in net_items {
   write(&mut tx, NETWORK, None, Some(vm_id), item.clone(), user).await?;
  }

  if !existing_pairs.is_empty() {
   let old_items: Vec<Value> = existing_pairs.iter().map(|(pub_ip, priv_ip)| {
    json!({"public_ip": pub_ip, "private_ip": priv_ip})
   }).collect();
   apply_ip_mappings(&mut tx, vm_id, &old_items).await?;
  }
 }

 let after_pairs = fetch_vm_mapping_pairs(&mut tx, vm_id).await?;
 audit_ip_mappings(&mut tx, vm_id, user, &before_pairs, &after_pairs).await?;

 health(&mut tx,vm_id).await?;
 let detail=vm_detail(&mut tx,vm_id).await?;
 tx.commit().await.map_err(db_error)?;
 Ok(detail)
}
pub async fn bulk_applications(pool:&PgPool,id:Uuid,adds:&[String],removes:&[String])->Result<(),ApiError>{
 let mut tx=pool.begin().await.map_err(db_error)?;
 if !removes.is_empty(){let lowered:Vec<String>=removes.iter().map(|n|n.to_lowercase()).collect();sqlx::query("DELETE FROM vm_applications WHERE vm_id=$1 AND lower(app_name)=ANY($2)").bind(id).bind(lowered).execute(&mut *tx).await.map_err(db_error)?;}
 for name in adds{sqlx::query("INSERT INTO vm_applications(id,vm_id,app_name) SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM vm_applications WHERE vm_id=$2 AND lower(app_name)=lower($3))").bind(Uuid::new_v4()).bind(id).bind(name).execute(&mut *tx).await.map_err(db_error)?;}
 health(&mut tx,id).await?;tx.commit().await.map_err(db_error)
}
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
