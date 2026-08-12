# API Reference

All routes are prefixed with `/api`. Authentication uses a session cookie set on `POST /api/auth/login`.

## Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/setup` | Check if admin setup is needed |
| POST | `/auth/setup` | Create first admin account |
| POST | `/auth/login` | Login (sets session cookie) |
| POST | `/auth/logout` | Logout |
| POST | `/auth/refresh` | Rotate the session cookie |

## Virtual Machines

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vms` | List VMs (`q`, `platform`, `status`, `environment`, `criticality`, `vm_type`, `monitoring_enabled`, `health`, `sort_by`, `sort_order`, `limit`, `offset`) |
| POST | `/vms` | Create VM |
| GET | `/vms/clusters` | List distinct cluster names |
| GET | `/vms/nodes` | List distinct node names |
| GET | `/vms/applications` | List distinct application names |
| GET | `/vms/tags` | List distinct tag names |
| GET | `/vms/owners` | List distinct owner names |
| GET | `/vms/{vm_id}` | Get VM with all sub-resources |
| PATCH | `/vms/{vm_id}` | Update VM |
| DELETE | `/vms/{vm_id}` | Delete VM |
| POST | `/vms/{vm_id}/clone` | Clone VM record |
| GET | `/vms/export` | Stream filtered VMs as CSV or XLSX (`status`, `health`, `ids`, `format=csv|xlsx`) |
| POST | `/vms/bulk` | Bulk update matching or selected VMs (`patch`, `filters`, `all_matching`, `vm_ids`) |

## Disks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vms/{vm_id}/disks` | List disks |
| POST | `/vms/{vm_id}/disks` | Add disk |
| PATCH | `/vms/{vm_id}/disks/{disk_id}` | Update disk |
| DELETE | `/vms/{vm_id}/disks/{disk_id}` | Delete disk |

## Network Interfaces

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vms/{vm_id}/networks` | List network interfaces |
| POST | `/vms/{vm_id}/networks` | Add interface |
| PATCH | `/vms/{vm_id}/networks/{network_id}` | Update interface |
| DELETE | `/vms/{vm_id}/networks/{network_id}` | Delete interface |

## Applications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vms/{vm_id}/applications` | List applications |
| POST | `/vms/{vm_id}/applications` | Add application |
| PATCH | `/vms/{vm_id}/applications/{app_id}` | Update application |
| DELETE | `/vms/{vm_id}/applications/{app_id}` | Delete application |

## Audit Log

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vms/{vm_id}/audit` | Audit log entries (`limit`, `offset`) |

## Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard` | Infrastructure summary and recently added VMs |

## Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/reports/summary` | Fleet totals and grouped counts (`total_vms`, `counts`) |
| GET | `/reports/{report_name}` | Download predefined CSV report |

## CSV Imports

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/imports/template` | Download a CSV template with every importable header |
| POST | `/imports/preview` | Upload CSV and get import preview |
| GET | `/imports/{batch_id}` | Get import batch details |
| POST | `/imports/{batch_id}/commit` | Commit an import batch |

## Users (admin only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users` | List users |
| POST | `/users` | Create user |
| PATCH | `/users/{user_id}` | Update user |

## Settings (admin only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/settings/app` | App settings (`decommission_notify_days`, `storage_usage_warn_pct`) |
| PATCH | `/settings/app` | Update app settings |
| GET | `/settings/ldap` | LDAP config (bind password returned only as `bind_password_set: bool`) |
| PUT | `/settings/ldap` | Replace LDAP config |
| POST | `/settings/ldap/test` | Test bind/search, optionally with a username+password |
| GET | `/settings/options` | Grouped dropdown options for all categories |
| GET | `/settings/options/all` | Flat list of all options |
| POST | `/settings/options` | Create dropdown option |
| PATCH | `/settings/options/{option_id}` | Update dropdown option |
| DELETE | `/settings/options/{option_id}` | Delete dropdown option |

## Storage

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/storage/arrays` | List storage arrays |
| POST | `/storage/arrays` | Create storage array |
| GET | `/storage/arrays/{array_id}` | Get storage array with child volumes |
| PATCH | `/storage/arrays/{array_id}` | Update storage array |
| DELETE | `/storage/arrays/{array_id}` | Delete storage array |
| GET | `/storage/arrays/{parent_id}/volumes` | List volumes for an array |
| POST | `/storage/arrays/{parent_id}/volumes` | Create volume in an array |
| PATCH | `/storage/arrays/{parent_id}/volumes/{item_id}` | Update volume |
| DELETE | `/storage/arrays/{parent_id}/volumes/{item_id}` | Delete volume |
| GET | `/storage/volumes/{parent_id}/luns` | List LUNs for a volume |
| POST | `/storage/volumes/{parent_id}/luns` | Create LUN in a volume |
| PATCH | `/storage/volumes/{parent_id}/luns/{item_id}` | Update LUN |
| DELETE | `/storage/volumes/{parent_id}/luns/{item_id}` | Delete LUN |
| GET | `/storage/volumes/{parent_id}/shares` | List shares for a volume |
| POST | `/storage/volumes/{parent_id}/shares` | Create share in a volume |
| PATCH | `/storage/volumes/{parent_id}/shares/{item_id}` | Update share |
| DELETE | `/storage/volumes/{parent_id}/shares/{item_id}` | Delete share |

## Physical Clusters

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/clusters` | List physical clusters |
| POST | `/clusters` | Create physical cluster |
| GET | `/clusters/{cluster_id}` | Get cluster with child nodes |
| PATCH | `/clusters/{cluster_id}` | Update physical cluster |
| DELETE | `/clusters/{cluster_id}` | Delete physical cluster |
| GET | `/clusters/{parent_id}/nodes` | List nodes for a cluster |
| POST | `/clusters/{parent_id}/nodes` | Create node in a cluster |
| PATCH | `/clusters/{parent_id}/nodes/{item_id}` | Update node |
| DELETE | `/clusters/{parent_id}/nodes/{item_id}` | Delete node |

## User Preferences

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/user/accent` | Current user's accent preset |
| PUT | `/user/accent` | Set accent — one of `orange`, `blue`, `violet`, `emerald`, `rose`, `amber` |
| GET | `/user/preferences/{page_key}` | Saved column preferences for a page |
| PUT | `/user/preferences/{page_key}` | Save column preferences |

## Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/notifications/decommissions` | VMs due for decommission within the configured window |
| POST | `/notifications/decommissions/ack` | Acknowledge the current decommission notifications |

## Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Returns `{"status":"ok"}` |
