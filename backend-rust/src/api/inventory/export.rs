use super::{filters,selected_ids,export_selection,service::{db_error,vm_details}};
use crate::api::deps::{AppState,ApiError,Viewer};
use axum::{Json,extract::{State,RawQuery},response::{Response,IntoResponse},http::{header,StatusCode}};
use serde_json::{json,Value};
const SCALARS:&str="name external_id fqdn platform datacenter sr_id cluster node status environment criticality vm_type cpu_cores memory_mb os_family os_distribution os_version owner business_owner technical_owner pmp_enabled monitoring_enabled backup_enabled backup_location ha_enabled tags last_patch_date last_vuln_scan_date security_remarks decommission_date last_verified_at description health_score created_at updated_at";
const DERIVED:[&str;5]=["disks","private_ip","public_ip","backup_ip","applications"];
const PREVIEW_ROWS:usize=5;
type Row<'a>=(&'a Value,Vec<String>);
fn all_columns()->Vec<&'static str>{SCALARS.split_whitespace().chain(DERIVED).collect()}
fn text(v:&Value)->String{match v{Value::Null=>String::new(),Value::String(s)=>s.clone(),_=>v.to_string()}}
fn joined(child:&Value,keys:&[&str])->String{let mut parts:Vec<_>=keys.iter().map(|k|text(&child[*k])).collect();while parts.last().is_some_and(String::is_empty){parts.pop();}parts.join(":")}
fn disk(d:&Value)->String{joined(d,&["disk_name","size_gb","storage_name","storage_type"])}
fn cell(v:&Value,key:&str)->String{match key{
 "tags"=>v[key].as_array().unwrap().iter().filter_map(Value::as_str).collect::<Vec<_>>().join(";"),
 "disks"=>v[key].as_array().unwrap().iter().map(disk).collect::<Vec<_>>().join(";"),
 "private_ip"|"public_ip"|"backup_ip"=>{let role=key.trim_end_matches("_ip");v["networks"].as_array().unwrap().iter().filter(|n|n["role"].as_str()==Some(role)).map(|n|text(&n["ip_address"])).collect::<Vec<_>>().join(";")}
 "applications"=>v[key].as_array().unwrap().iter().map(|a|joined(a,&["app_name","app_owner"])).collect::<Vec<_>>().join(";"),
 _=>text(&v[key])}}
fn table<'a>(vms:&'a[Value],cols:&[&str],per_disk:bool)->Vec<Row<'a>>{
 let disk_col=cols.iter().position(|c|*c=="disks").filter(|_|per_disk);
 let mut out=Vec::new();
 for vm in vms{let base:Vec<_>=cols.iter().map(|c|cell(vm,c)).collect();let disks=vm["disks"].as_array().unwrap();
  match disk_col{Some(i)if disks.len()>1=>for d in disks{let mut row=base.clone();row[i]=disk(d);out.push((vm,row));},_=>out.push((vm,base))}}
 out
}
fn parse_columns(raw:Option<&str>,known:&[&'static str])->Result<Vec<&'static str>,ApiError>{
 let Some(raw)=raw else{return Ok(known.to_vec())};
 let mut cols=Vec::new();
 for name in raw.split(','){let name=name.trim();let key=known.iter().find(|k|**k==name).ok_or_else(||ApiError::invalid(format!("Unknown export column: {name}")))?;if cols.contains(key){return Err(ApiError::invalid(format!("Duplicate export column: {name}")));}cols.push(*key);}
 Ok(cols)
}
pub(crate) fn csv_text(value:String)->String{
  let candidate=value.trim_start_matches(' ');
  if candidate.starts_with(['=','+','-','@','\t','\r','\n']){format!("'{value}")}else{value}
}
fn csv(rows:&[Row],headers:&[&str])->Result<Vec<u8>,ApiError>{
  let mut writer=csv::WriterBuilder::new().terminator(csv::Terminator::CRLF).from_writer(Vec::new());writer.write_record(headers).map_err(|e|ApiError::internal(e.to_string()))?;
  for(_,row)in rows{writer.write_record(row.iter().cloned().map(csv_text)).map_err(|e|ApiError::internal(e.to_string()))?;}
  writer.into_inner().map_err(|e|ApiError::internal(e.to_string()))
}
pub async fn export(State(s):State<AppState>,_:Viewer,RawQuery(raw):RawQuery)->Result<Response,ApiError>{
  let p=filters::query(raw);filters::validate_query(&p)?;let format=filters::first(&p,"format").unwrap_or("csv");if !["csv","xlsx","json"].contains(&format){return Err(ApiError::invalid("Invalid export format"));}
  let cols=parse_columns(filters::first(&p,"columns"),&all_columns())?;
  let per_disk=match filters::first(&p,"disk_layout").unwrap_or("joined"){"joined"=>false,"rows"=>true,_=>return Err(ApiError::invalid("Invalid disk layout"))};
  let mut ids=selected_ids(&s,&p,export_selection(&p)?).await?;let total=ids.len();if format=="json"{ids.truncate(PREVIEW_ROWS);}
  let mut c=s.pool.acquire().await.map_err(db_error)?;let vms=vm_details(&mut c,&ids).await?;
  let rows=table(&vms,&cols,per_disk);
  if format=="json"{return Ok(Json(json!({"total":total,"columns":cols,"rows":rows.into_iter().map(|(_,r)|r).collect::<Vec<_>>()})).into_response());}
  let(bytes,media,filename)=if format=="csv"{
   (csv(&rows,&cols)?,"text/csv; charset=utf-8","vm-inventory.csv")
  }else{(xlsx(&rows,&cols)?,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","vm-inventory.xlsx")};
  Ok((StatusCode::OK,[(header::CONTENT_TYPE,media.to_owned()),(header::CONTENT_DISPOSITION,format!("attachment; filename=\"{filename}\""))],bytes).into_response())
}
fn xlsx(rows:&[Row],headers:&[&str])->Result<Vec<u8>,ApiError>{
 let mut workbook=rust_xlsxwriter::Workbook::new();let sheet=workbook.add_worksheet();sheet.set_name("Inventory").map_err(|e|ApiError::internal(e.to_string()))?;
 let bold=rust_xlsxwriter::Format::new().set_bold();let date_format=rust_xlsxwriter::Format::new().set_num_format("yyyy-mm-dd");
 let empty_format=rust_xlsxwriter::Format::new().set_num_format("@");
 for(i,h)in headers.iter().enumerate(){sheet.write_string_with_format(0,i as u16,*h,&bold).map_err(|e|ApiError::internal(e.to_string()))?;sheet.set_column_width(i as u16,(h.len()+4).clamp(12,40)as f64).map_err(|e|ApiError::internal(e.to_string()))?;}
 sheet.set_freeze_panes(1,0).map_err(|e|ApiError::internal(e.to_string()))?;
 for(index,(vm,values))in rows.iter().enumerate(){for(col,value)in values.iter().enumerate(){let row=(index+1)as u32;let column=col as u16;let key=headers[col];if value.is_empty(){if key=="tags"||DERIVED.contains(&key){sheet.write_blank(row,column,&empty_format).map_err(|e|ApiError::internal(e.to_string()))?;}continue;}
  if ["cpu_cores","memory_mb","health_score"].contains(&key){sheet.write_number(row,column,vm[key].as_f64().unwrap_or(0.)).map_err(|e|ApiError::internal(e.to_string()))?;}
  else if key.ends_with("_date")||["last_verified_at","created_at","updated_at"].contains(&key){let date=if value.len()>=19{value[..19].replace('T'," ")}else{value.clone()};let parsed=rust_xlsxwriter::ExcelDateTime::parse_from_str(&date).map_err(|e|ApiError::internal(e.to_string()))?;sheet.write_datetime_with_format(row,column,&parsed,&date_format).map_err(|e|ApiError::internal(e.to_string()))?;}
  else{sheet.write_string(row,column,value).map_err(|e|ApiError::internal(e.to_string()))?;}
 }}
 sheet.autofilter(0,0,rows.len().max(1)as u32,(headers.len()-1)as u16).map_err(|e|ApiError::internal(e.to_string()))?;
 workbook.save_to_buffer().map_err(|e|ApiError::internal(e.to_string()))
}
#[cfg(test)]mod workbook_tests{use super::*;use std::io::{Cursor,Read};use serde_json::json;
 #[test]fn serialized_workbook_preserves_derived_empty_cells(){
  let vm=json!({"name":"vm","tags":[],"disks":[{"disk_name":"boot","size_gb":32}],"networks":[{"role":"private","ip_address":"192.0.2.10"}],"applications":[]});
  let headers=all_columns();
  let bytes=xlsx(&table(&[vm],&headers,false),&headers).unwrap();let mut archive=zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
  let mut xml=String::new();archive.by_name("xl/worksheets/sheet1.xml").unwrap().read_to_string(&mut xml).unwrap();
  for cell in ["AL2","AM2","AN2"]{assert!(xml.contains(&format!("<c r=\"{cell}\"")),"missing derived empty cell {cell}");}
  assert!(!xml.contains("<c r=\"B2\""),"nullable external_id should stay absent");
 }
 #[test]fn csv_export_does_not_emit_formula_cells(){
  let vm=json!({"name":"  =HYPERLINK(\"https://example.invalid\")","tags":[],"disks":[],"networks":[],"applications":[]});
  let headers=all_columns();
  let bytes=csv(&table(&[vm],&headers,false),&headers).unwrap();
  let mut reader=csv::Reader::from_reader(bytes.as_slice());
  let row=reader.records().next().unwrap().unwrap();
  assert_eq!(&row[0],"'  =HYPERLINK(\"https://example.invalid\")");
 }
}
#[cfg(test)]mod column_tests{use super::*;
  #[test]fn columns_keep_requested_order_and_reject_bad_input(){
   let known=all_columns();
   assert_eq!(parse_columns(Some("status,name"),&known).unwrap(),["status","name"]);
   assert_eq!(parse_columns(None,&known).unwrap().len(),known.len());
   assert!(parse_columns(Some("name,bogus"),&known).is_err());
   assert!(parse_columns(Some("name,name"),&known).is_err());
   assert!(parse_columns(Some(""),&known).is_err());
  }
  #[test]fn per_disk_layout_repeats_vm_fields_per_disk(){
   let vm=json!({"name":"vm","tags":[],"disks":[{"disk_name":"a","size_gb":1},{"disk_name":"b","size_gb":2}],"networks":[],"applications":[]});
   let vms=[vm];
   let rows=table(&vms,&["name","disks"],true);
   assert_eq!(rows.iter().map(|(_,r)|r.clone()).collect::<Vec<_>>(),[["vm","a:1"],["vm","b:2"]]);
   assert_eq!(table(&vms,&["name","disks"],false)[0].1,["vm","a:1;b:2"]);
   assert_eq!(table(&vms,&["name"],true).len(),1);
  }
}
