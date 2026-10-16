use super::{filters,selected_ids,service::{db_error,vm_details},resource::invalid};
use crate::api::deps::{AppState,ApiError,Viewer};
use axum::{extract::{State,RawQuery},response::{Response,IntoResponse},http::{header,StatusCode}};
use serde_json::Value;
const SCALARS:&str="name external_id fqdn platform datacenter sr_id cluster node status environment criticality vm_type cpu_cores memory_mb os_family os_distribution os_version owner business_owner technical_owner pmp_enabled monitoring_enabled backup_enabled backup_location ha_enabled tags last_patch_date last_vuln_scan_date security_remarks decommission_date last_verified_at description health_score created_at updated_at";
fn text(v:&Value)->String{match v{Value::Null=>String::new(),Value::String(s)=>s.clone(),_=>v.to_string()}}
fn joined(child:&Value,keys:&[&str])->String{let mut parts:Vec<_>=keys.iter().map(|k|text(&child[*k])).collect();while parts.last().is_some_and(String::is_empty){parts.pop();}parts.join(":")}
fn export_row(v:&Value)->Vec<String>{let mut row:Vec<_>=SCALARS.split_whitespace().map(|key|if key=="tags"{v[key].as_array().unwrap().iter().filter_map(Value::as_str).collect::<Vec<_>>().join(";")}else{text(&v[key])}).collect();row.push(v["disks"].as_array().unwrap().iter().map(|d|joined(d,&["disk_name","size_gb","storage_name","storage_type"])).collect::<Vec<_>>().join(";"));for role in ["private","public","backup"]{row.push(v["networks"].as_array().unwrap().iter().filter(|n|n["role"].as_str()==Some(role)).map(|n|text(&n["ip_address"])).collect::<Vec<_>>().join(";"));}row.push(v["applications"].as_array().unwrap().iter().map(|a|joined(a,&["app_name","app_owner"])).collect::<Vec<_>>().join(";"));row}
fn csv_text(value:String)->String{
 if value.starts_with(['=','+','-','@','\t','\r']){format!("'{value}")}else{value}
}
fn csv(vms:&[Value],headers:&[&str])->Result<Vec<u8>,ApiError>{
 let mut writer=csv::WriterBuilder::new().terminator(csv::Terminator::CRLF).from_writer(Vec::new());writer.write_record(headers).map_err(|e|ApiError::internal(e.to_string()))?;
 for vm in vms{writer.write_record(export_row(vm).into_iter().map(csv_text)).map_err(|e|ApiError::internal(e.to_string()))?;}
 writer.into_inner().map_err(|e|ApiError::internal(e.to_string()))
}
pub async fn export(State(s):State<AppState>,_:Viewer,RawQuery(raw):RawQuery)->Result<Response,ApiError>{
 let p=filters::query(raw);filters::validate_query(&p)?;let format=filters::first(&p,"format").unwrap_or("csv");if !["csv","xlsx"].contains(&format){return Err(invalid("Invalid export format"));}
 let ids=selected_ids(&s,&p,true).await?;let mut c=s.pool.acquire().await.map_err(db_error)?;let vms=vm_details(&mut c,&ids).await?;
 let headers:Vec<_>=SCALARS.split_whitespace().chain(["disks","private_ip","public_ip","backup_ip","applications"]).collect();
 let(bytes,media,filename)=if format=="csv"{
  (csv(&vms,&headers)?,"text/csv; charset=utf-8","vm-inventory.csv")
 }else{(xlsx(&vms,&headers)?,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","vm-inventory.xlsx")};
 Ok((StatusCode::OK,[(header::CONTENT_TYPE,media.to_owned()),(header::CONTENT_DISPOSITION,format!("attachment; filename=\"{filename}\""))],bytes).into_response())
}
fn xlsx(vms:&[Value],headers:&[&str])->Result<Vec<u8>,ApiError>{
 let mut workbook=rust_xlsxwriter::Workbook::new();let sheet=workbook.add_worksheet();sheet.set_name("Inventory").map_err(|e|ApiError::internal(e.to_string()))?;
 let bold=rust_xlsxwriter::Format::new().set_bold();let date_format=rust_xlsxwriter::Format::new().set_num_format("yyyy-mm-dd");
 let empty_format=rust_xlsxwriter::Format::new().set_num_format("@");let scalar_count=SCALARS.split_whitespace().count();
 for(i,h)in headers.iter().enumerate(){sheet.write_string_with_format(0,i as u16,*h,&bold).map_err(|e|ApiError::internal(e.to_string()))?;sheet.set_column_width(i as u16,(h.len()+4).clamp(12,40)as f64).map_err(|e|ApiError::internal(e.to_string()))?;}
 sheet.set_freeze_panes(1,0).map_err(|e|ApiError::internal(e.to_string()))?;
 for(index,vm)in vms.iter().enumerate(){let values=export_row(vm);for(col,value)in values.iter().enumerate(){let row=(index+1)as u32;let column=col as u16;let key=headers[col];if value.is_empty(){if key=="tags"||col>=scalar_count{sheet.write_blank(row,column,&empty_format).map_err(|e|ApiError::internal(e.to_string()))?;}continue;}
  if ["cpu_cores","memory_mb","health_score"].contains(&key){sheet.write_number(row,column,vm[key].as_f64().unwrap_or(0.)).map_err(|e|ApiError::internal(e.to_string()))?;}
  else if key.ends_with("_date")||["last_verified_at","created_at","updated_at"].contains(&key){let date=if value.len()>=19{value[..19].replace('T'," ")}else{value.clone()};let parsed=rust_xlsxwriter::ExcelDateTime::parse_from_str(&date).map_err(|e|ApiError::internal(e.to_string()))?;sheet.write_datetime_with_format(row,column,&parsed,&date_format).map_err(|e|ApiError::internal(e.to_string()))?;}
  else{sheet.write_string(row,column,value).map_err(|e|ApiError::internal(e.to_string()))?;}
 }}
 sheet.autofilter(0,0,vms.len().max(1)as u32,(headers.len()-1)as u16).map_err(|e|ApiError::internal(e.to_string()))?;
 workbook.save_to_buffer().map_err(|e|ApiError::internal(e.to_string()))
}
#[cfg(test)]mod workbook_tests{use super::*;use std::io::{Cursor,Read};use serde_json::json;
 #[test]fn serialized_workbook_preserves_derived_empty_cells(){
  let vm=json!({"name":"vm","tags":[],"disks":[{"disk_name":"boot","size_gb":32}],"networks":[{"role":"private","ip_address":"192.0.2.10"}],"applications":[]});
  let headers:Vec<_>=SCALARS.split_whitespace().chain(["disks","private_ip","public_ip","backup_ip","applications"]).collect();
  let bytes=xlsx(&[vm],&headers).unwrap();let mut archive=zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
  let mut xml=String::new();archive.by_name("xl/worksheets/sheet1.xml").unwrap().read_to_string(&mut xml).unwrap();
  for cell in ["AL2","AM2","AN2"]{assert!(xml.contains(&format!("<c r=\"{cell}\"")),"missing derived empty cell {cell}");}
  assert!(!xml.contains("<c r=\"B2\""),"nullable external_id should stay absent");
 }
 #[test]fn csv_export_does_not_emit_formula_cells(){
  let vm=json!({"name":"=HYPERLINK(\"https://example.invalid\")","tags":[],"disks":[],"networks":[],"applications":[]});
  let headers:Vec<_>=SCALARS.split_whitespace().chain(["disks","private_ip","public_ip","backup_ip","applications"]).collect();
  let bytes=csv(&[vm],&headers).unwrap();
  let mut reader=csv::Reader::from_reader(bytes.as_slice());
  let row=reader.records().next().unwrap().unwrap();
  assert_eq!(&row[0],"'=HYPERLINK(\"https://example.invalid\")");
 }
}
