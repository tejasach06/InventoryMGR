# Alerts

InventoryMGR never contacts a hypervisor, so every alert is derived from stored records. Alerts are computed on read for each request; there is no background scheduler and no alert history table.

## Alert surfaces at a glance

| Alert | Where it appears | Source | Tag-suppressed? |
|-------|------------------|--------|-----------------|
| Powered off > 90 days | Dashboard "VM Alerts" | `GET /api/dashboard` | **Yes** (`template`, `backup`) |
| Past decommission date | Dashboard "VM Alerts" | `GET /api/dashboard` | No |
| No IP address | Dashboard "VM Alerts" | `GET /api/dashboard` | **Yes** (`template`, `backup`) |
| Upcoming decommission | Header notification bell | `GET /api/notifications/decommissions` | No |
| Storage over threshold | Dashboard tile, Storage pages | `GET /api/storage/...` | No (not VM-scoped) |
| Health score | Inventory `Health` column, filters | `Vm.health_score` column | No |

## Tag suppression

`backend/app/api/routes/dashboard.py` defines:

```python
EXCLUDED_TAGS = {"template", "backup"}
```

Matching is case-insensitive and whitespace-trimmed: each tag is compared as `tag.strip().lower()`. `Template`, ` BACKUP `, and `backup` all suppress an alert. Substrings do not match: `backup-server` is not suppressed. A VM is dropped from a list if any of its tags is in `EXCLUDED_TAGS`.

Suppression applies to exactly two dashboard lists: **Powered off > 90 days** and **No IP address**. It does not apply to **Past decommission date**, notification bell, or storage alerts.

**Known behavior:** suppression happens in Python after SQL query:

1. Dashboard headline counters (`powered_off`, `without_monitoring`, `without_applications`, `total`) are pure SQL aggregates and include tagged VMs.
2. Drill-down links `/inventory?shutdown_stale=true` and `/inventory?missing_ip=true` call `GET /api/vms`, which applies no tag exclusion. Inventory list therefore shows tagged VMs hidden by dashboard, and row counts can disagree.
3. Suppression is applied after `LIMIT 50` (`ALERT_LIST_LIMIT`), so dashboard list can return fewer than 50 rows while more untagged matches exist.

To suppress a VM, add tag `template` or `backup` through VM edit form's **Tags** field, or through bulk edit (`tags_add`) on Inventory page. Tag names are hardcoded; no settings UI exists for them.

## Dashboard VM alerts

### Powered off > 90 days

`shutdown_stale_condition()` in `backend/app/services/vms.py` triggers when:

```text
Vm.status == powered_off
AND shutdown_since <= now - 90 days
```

`SHUTDOWN_STALE_DAYS = 90`. `shutdown_since` is newest `AuditLog.changed_at` where `field_name == "status"` and `new_value == "powered_off"`, falling back to `Vm.created_at` when no audit row exists (`shutdown_since_expr()`). A VM imported already powered off therefore ages from creation date. Results are ordered oldest first and limited to 50. Drill-down: `/inventory?shutdown_stale=true`. Payload `days` is computed in Python as whole days since `shutdown_since`.

### Past decommission date

`decommission_overdue_condition()` triggers when `decommission_date IS NOT NULL` and `decommission_date <= today (UTC)` and `status != decommissioned`. Results are ordered by earliest date and limited to 50. Drill-down: `/inventory?decommission_overdue=true`. Clear alert by setting status to `decommissioned`, or moving or clearing date. This alert is not tag-suppressed.

### No IP address

`missing_ip_condition()` triggers when no `vm_networks` row exists for VM. Any role counts, so one backup-role IP clears alert. Results are ordered by name and limited to 50; payload `days` is always `0`. Drill-down: `/inventory?missing_ip=true`.

## Decommission notification bell

`backend/app/services/notifications.py` lists VMs when `decommission_date <= today + decommission_notify_days`, `lifecycle != retired`, and `status != decommissioned`. `decommission_notify_days` defaults to `30` (`DEFAULT_NOTIFY_DAYS`), is stored in `app_settings` under key `decommission_notify_days`, and admins can edit it at Settings through `PATCH /api/settings/app`. Overdue VMs remain listed with negative `days_remaining`.

Acknowledgement is per user and per date: `DecommissionAck` stores `acked_date`; row becomes `unread` again whenever `decommission_date` changes to a value different from acknowledged one. `POST /api/notifications/decommissions/ack` with no `vm_ids` acknowledges everything currently due. Frontend `NotificationBell` refetches every 5 minutes and on window focus, and badge counts only `unread` rows. This alert is not tag-suppressed.

## Storage capacity alerts

`backend/app/services/storage.py` calculates `used_pct = round(used / capacity * 100, 1)`; `over_threshold` is true when `used_pct >= storage_usage_warn_pct`. Default is `85` (`DEFAULT_WARN_PCT`), stored in `app_settings` under key `storage_usage_warn_pct`, and admins can edit it through `PATCH /api/settings/app`. Capacity `0` yields `used_pct = null` and `over_threshold = false`, so an unfilled capacity never alerts. This applies to arrays and volumes. Dashboard **Storage alerts** tile counts arrays over threshold.

## Health score

Health score is not a notification. It is a 0–100 completeness score stored on `Vm.health_score`, recomputed by `recompute_health()` on every VM or child-record mutation. `compute_health_score()` in `backend/app/db/models.py` assigns:

| Field present | Points |
|---------------|--------|
| `description` | 10 |
| any of `business_owner` / `technical_owner` / `owner` | 15 |
| ≥1 application | 20 |
| ≥1 network/IP | 15 |
| ≥1 disk | 15 |
| `monitoring_enabled` | 10 |
| `decommission_date` | 15 |

Total: 100.

`GET /api/vms?health=` accepts exactly `below_50` (`< 50`), `below_75` (`< 75`), and `complete` (`>= 100`).

**Known inconsistency:** `frontend/src/components/filters/filterConfig.ts` declares health filter options `healthy | warning | critical | unknown`, while backend `Query(pattern="^(below_50|below_75|complete)$")` rejects those frontend values with HTTP 422.

## Troubleshooting: "why is this VM not alerting?"

1. It is tagged `template` or `backup` (case-insensitive), so stale-shutdown and no-IP lists hide it.
2. It is beyond 50-row list limit.
3. Status is `decommissioned`, so overdue list and notification bell exclude it.
4. Lifecycle is `retired`, so notification bell excludes it only.
5. It is already acknowledged at current `decommission_date`, so bell row is read and badge does not count it.
6. Its `decommission_date` is farther out than `decommission_notify_days`.
7. Powered-off clock runs from last `status → powered_off` audit row, or `created_at` if none; a status flip resets it.
8. Storage array has `total_capacity_gb = 0`, or storage volume has `capacity_gb = 0`, so it never crosses threshold.
