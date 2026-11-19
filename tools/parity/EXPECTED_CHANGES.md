# Expected Parity Baseline Changes: Virtual Hosts Feature

This document records the reviewed and authorized contract changes applied to the frozen parity baselines (`tools/parity/`) for the InventoryMGR Virtual Hosts feature (commit `2d9e898a517a592d457ae68cea8c9ddff3882874`, ledger head `0025`).

Per `tools/parity/AGENTS.md`, baselines are compatibility fixtures and must not be updated to hide unintentional behavior regressions. Every difference documented here has been classified and verified against actual native test evidence from the Aspire test run (`.audit/virtual-hosts-review/aspire-evidence/`).

---

## 1. Schema & Migration Catalog (`tools/parity/migration_catalog.json`)

The migration catalog tracks database schema parity across migrations (empty database setup and historical upgrade boundaries).

### Contract Changes
- **Removed Column**: `vms.fqdn`
  - Data Type: `character varying` (`udt_name: "varchar"`)
  - Nullable: `YES`
  - Ordinal Position: 28
- **Added Column**: `vms.virtual_hosts`
  - Data Type: `ARRAY` (`udt_name: "_text"`)
  - Nullable: `NO`
  - Default: `'{}'::text[]`
  - Ordinal Position: 45 (appended as the last column of the `vms` table)

### Preserved Byte-for-Byte
- All 196 other column definitions across all tables remain identical.
- All constraints, table indexes, and PostgreSQL enum definitions (`criticality`, `dropdown_category`, `environment`, `import_action`, `import_status`, `network_role`, `os_family`, `platform`) are identical.
- Semantics match the actual native catalog artifact `evidence/stages/migrations/empty.json` generated on Aspire.

---

## 2. HTTP Baseline (`tools/parity/http_baseline.json`)

The HTTP baseline contains recorded transcripts for 245 operations across the API surface.

### Scope of Changes
- Total operations in suite: **245**
- Unmodified cases preserved byte-for-byte: **224**
- Authorized modified cases: **21** (containing exactly 58 field-level differences)

### Classification of Approved Differences
1. **VM Object Responses** (Cases 113, 114, 115, 119, 176, 177, 227)
   - Scope: `POST /api/vms`, `GET /api/vms/{id}`, `PATCH /api/vms/{id}`, `POST /api/vms/{id}/clone`.
   - Delta: Removed key `"fqdn": null`; added key `"virtual_hosts": []`.
   - All other fields (including CPU, memory, disks, networks, tags, timestamps) remain identical.
2. **Paginated VM List Responses** (Cases 135, 136, 138, 139, 180, 210, 224, 244)
   - Scope: `GET /api/vms` with various query parameters (pagination, filters, search, exclusion flags).
   - Delta: For every VM item in `"items"`, `"fqdn": null` was removed and `"virtual_hosts": []` was added.
   - Pagination totals and order are unchanged.
3. **User Preferences** (Case 105)
   - Scope: `GET /api/user/preferences/inventory`.
   - Delta: Column definition key renamed from `"key": "fqdn"` to `"key": "virtual_hosts"` (order: 8, visible: false).
4. **VM Data Exports** (Cases 150, 151)
   - Scope: `GET /api/vms/export?format=csv` (Case 150) and `GET /api/vms/export?format=xlsx` (Case 151).
   - Delta: Header column renamed from `fqdn` to `virtual_hosts`. Data row cells preserve empty string representation for VMs with empty host lists.
5. **System Report Exports** (Cases 185, 186)
   - Scope: `GET /api/reports/linux?format=csv` and `GET /api/reports/windows?format=csv`.
   - Delta: Report CSV header column renamed from `fqdn` to `virtual_hosts`. Data rows preserved.
6. **CSV Import Template** (Case 191)
   - Scope: `GET /api/imports/template`.
   - Delta: Header column renamed from `fqdn` to `virtual_hosts`.
   - Sample row values updated from legacy scalar strings (`"web-01.corp.local"`, `"test-02.corp.local"`) to valid JSON array strings (`"[\"web-01.corp.local\"]"`, `"[\"test-02.corp.local\"]"`).

### Preserved Invariants
- HTTP status codes, response `content_type` headers, session cookies, and security headers (`x-content-type-options`, `x-frame-options`, `referrer-policy`, `permissions-policy`) are identical across all 245 cases.
- Reconstructed directly from native output diff `evidence/verify/http/parity.diff`.

---

## 3. OpenAPI Baseline Decision (`tools/parity/openapi_baseline.json`)

- **Analysis of Parity Harness**:
  - `tools/parity/src/http.rs` and `tools/parity/src/http_client.rs` consume `openapi_baseline.json` as `SPEC`.
  - The harness only uses the `paths` object to discover endpoint paths and HTTP methods, issue unauthenticated probe requests, and verify endpoint coverage (`check_coverage`).
  - The harness does not validate request/response body schemas against OpenAPI definitions, nor does the Rust backend generate or expose a live dynamic OpenAPI specification.
  - The Aspire test run recorded `openapi_sha256`: `cb5c07776bf7df6471e4b85f12f8925dd3591624634199fc193707be49bf14a8`.
- **Decision**:
  - `tools/parity/openapi_baseline.json` is preserved **byte-for-byte unchanged**.
  - No speculative schema edits were made, avoiding untested drift against the frozen test harness contract.

---

## 4. Historical Fixtures & Upgrade Invariants

- `tools/parity/migration_head.txt`: Remains at `0025`.
- `tools/parity/historical_initial.sql`: Preserved byte-for-byte.
- Native migration chain `backend-rust/migrations/0001_inventory_schema.sql` (lines 697–706) preserves the linear revision history from head `0024` to `0025`, migrating existing `fqdn` values into single-element arrays and defaulting NULL/empty values to empty arrays.
- Historical upgrade boundaries verified on Aspire across revisions `0004`, `0010`, `debd8a48a62e`, and `0024` with user and VM row preservation.

---

## 5. IP Mappings & Network Preconditions Feature (PR #72, ledger head `0026`)

This section documents the reviewed contract differences and baseline updates for the VM public-to-private IP mappings and deterministic network precondition feature.

### Scope of Changes
- Total operations in suite: **245**
- Unmodified cases preserved byte-for-byte: **227**
- Authorized modified cases: **18** (Cases 113, 114, 115, 119, 135, 136, 138, 139, 150, 151, 176, 177, 180, 191, 210, 224, 227, 244)

### Classification of Approved Differences
1. **VM Object Responses** (Cases 113, 114, 115, 119, 176, 177, 227)
   - Scope: `POST /api/vms`, `GET /api/vms/{id}`, `PATCH /api/vms/{id}`, `POST /api/vms/{id}/clone`.
   - Delta: Added fields `"ip_mappings": []`, `"mapping_precondition": "<token:N>"`, and `"network_precondition": "<token:N>"`.
   - Normalization: `tools/parity/src/http_client.rs` aliases 64-character SHA-256 hex precondition tokens as `<token:N>`, mirroring `<uuid:N>` normalization for runtime UUIDs.
2. **Paginated VM List Responses** (Cases 135, 136, 138, 139, 180, 210, 224, 244)
   - Scope: `GET /api/vms` queries with pagination, filters, and searches.
   - Delta: Added `"ip_mappings": []`, `"mapping_precondition": "<token:N>"`, and `"network_precondition": "<token:N>"` to each VM record.
3. **CSV & XLSX Exports** (Cases 150, 151)
   - Scope: `GET /api/vms/export?format=csv` and `GET /api/vms/export?format=xlsx`.
   - Delta: Added `ip_mappings` column to header.
4. **CSV Import Template** (Case 191)
   - Scope: `GET /api/imports/template`.
   - Delta: Added `ip_mappings` column to template header.

### Invariants Preserved
- All 89 OpenAPI operations remain covered.
- All HTTP status codes, security headers, and cookie behavior remain identical.
- Migrations (`0026`) preserve all historical rows across empty and upgrade boundaries.
