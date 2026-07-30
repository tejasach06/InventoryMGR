---
target: frontend/src/routes/InventoryPage.tsx
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-07-28T18-53-43Z
slug: frontend-src-routes-inventorypage-tsx
---
Method: dual-agent (A: AssessmentA · B: AssessmentB)

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Staged filter changes inside FilterDrawer invisible until Apply; table loading skeleton hardcodes 5 columns causing layout shift |
| 2 | Match System / Real World | 3 | Infrastructure terms accurate (vCPU, FQDN, PMP), but bulk tag input uses raw comma strings instead of interactive tag pills |
| 3 | User Control and Freedom | 2 | "Clear all" resets filter facets but leaves search query `q` intact; floating bulk toolbar lacks "Deselect All" button |
| 4 | Consistency and Standards | 2 | `SegmentedControl` strips status/criticality colors while table accents and Badges rely on them; mobile `VmCard` omits status left-border accent |
| 5 | Error Prevention | 1 | **Critical safety risk:** `ConfirmDialog` for bulk edits warns X records will be modified but fails to preview staged fields/values (`pendingPatch`) |
| 6 | Recognition Rather Than Recall | 2 | Active filter chips appear on header, but FilterDrawer options lack live fleet count badges (e.g. `running (142)` vs `suspended (3)`) |
| 7 | Flexibility and Efficiency | 3 | Excellent search shortcuts (`Escape` blur), persistent searchParams state, and fast CSV/Excel export |
| 8 | Aesthetic and Minimalist Design | 2 | `BulkEditDrawer` presents 15+ unsegmented fields in a raw 2-column grid; `EmptyState` renders out-of-place cardboard box SVG |
| 9 | Error Recovery | 3 | Clear API error alerts (`detailMessage`); filter states reset easily via single-click chip dismissal or "Clear all" |
| 10 | Help and Documentation | 2 | Text fields in `BulkEditDrawer` give no indication that blank means "unchanged" while clearing cannot wipe existing values |
| **Total** | | **22/40** | **Needs Improvement** |

#### Design Specificity Verdict

**LLM assessment**: 6 / 10 ("Interchangeable Enterprise SaaS with Instrument Panel Veneer"). InventoryMGR names "The Dark Instrument Panel" as its north star, but `InventoryPage.tsx` drifts into generic SaaS habits: `SegmentedControl` strips data status colors, `EmptyState` renders an e-commerce cardboard shipping box SVG, and `BulkEditDrawer` presents 15+ unsegmented fields without diff telemetry.

**Deterministic scan**: Detector CLI scan returned 0 unsuppressed findings on standard config, and 1 finding on unsuppressed scan (`side-tab` at `ui.tsx:54`). Line 54 has an active inline waiver (`/* impeccable-disable-line side-tab -- data row status border */`). This left-border accent is explicitly mandated by DESIGN.md Section 5 ("Tables - Row accent") as a load-bearing exception under the Signal Rule. Confirmed valid false positive.

**Visual overlays**: Skipped dynamic browser injection because no dev server was active on localhost:3000 / localhost:5173. Static scan verified complete.

#### Overall Impression
InventoryMGR has a strong data architecture and solid keyboard shortcuts, but lacks the visual precision and safety telemetry expected of a true dark instrument panel. Bulk edit confirmation lacks payload previews, control pills suppress signal colors, and forms/drawers lack structural hierarchy.

#### What's Working
1. **URL-Synchronized State**: Search, filtering, sorting, pagination, and persistent column preferences (`useColumnPreferences`) map cleanly to URL `searchParams`.
2. **Keyboard-First Toolbar**: Fluid keyboard search handling (`Escape` to clear), dropdown portal positioning, and instant CSV export.
3. **Responsive Table Degradation**: Desktop data table with status left-accent borders (`rowAccent`) cleanly degrades into a mobile card layout (`VmCard`).

#### Priority Issues

- **[P1] Safety Hazard in Bulk Edit Confirmation Dialog**
  - **Why it matters**: Modifying hundreds of VM records without displaying staged fields (`pendingPatch`) invites catastrophic accidental overwrites.
  - **Fix**: Render a structured diff preview of staged changes (e.g. `Status: active → decommissioned`, `Owner: → devops`) inside `ConfirmDialog`.
  - **Suggested command**: `/impeccable harden`

- **[P1] Violating "The Signal Rule" in SegmentedControl**
  - **Why it matters**: `SegmentedControl.tsx` explicitly strips status and criticality colors, creating visual inconsistency with table accents and badges.
  - **Fix**: Restore semantic status/criticality colors on active `SegmentedControl` toggle pills.
  - **Suggested command**: `/impeccable colorize`

- **[P2] Unstructured Cognitive Overload in BulkEditDrawer**
  - **Why it matters**: High extraneous cognitive load; sysadmins must scan 15 unsegmented inputs to find 1 or 2 fields.
  - **Fix**: Group inputs into distinct visual fieldsets ("Core State & Lifecycle", "Location & Network", "Ownership & Flags") with clear headers.
  - **Suggested command**: `/impeccable layout`

- **[P2] Out-of-Place Illustration Fluff in EmptyState**
  - **Why it matters**: Cardboard shipping box SVG looks like generic consumer e-commerce, not an IT infrastructure instrument panel.
  - **Fix**: Replace cardboard box SVG with a dark instrument radar/node matrix graphic.
  - **Suggested command**: `/impeccable delight`

- **[P3] Inaccessible Column Reordering in ColumnDrawer**
  - **Why it matters**: HTML5 Drag-and-Drop lacks keyboard reorder controls, failing WCAG AA accessibility.
  - **Fix**: Add keyboard "Move Up" / "Move Down" buttons for each column item in `ColumnDrawer`.
  - **Suggested command**: `/impeccable adapt`

#### Persona Red Flags

- **Alex (Power User)**: Cannot see fleet summary metrics (total vCPUs, RAM, running counts) at header; cannot reorder columns via keyboard; cannot bulk-wipe fields in `BulkEditDrawer` (blank input leaves field unchanged).
- **Jordan (First-Timer)**: Confused by colorless `SegmentedControl` filter pills next to status-colored table row borders; overwhelmed by 15 unsegmented inputs in `BulkEditDrawer`.
- **IT Ops Admin (Project Specific)**: High anxiety when bulk updating 200+ VMs because confirmation modal says "Are you sure?" without listing which fields are being changed.

#### Minor Observations
- `TableSkeleton` hardcodes 5 columns causing visual layout shift when 8+ columns populate.
- Mobile `VmCard` hides status badges and IP addresses entirely.
- `filterBarClass` uses a soft gradient background (`linear-gradient(...)`) that introduces unnecessary decorative softness.

#### Questions to Consider
1. What if `InventoryPage` displayed fleet telemetry (total vCPUs, RAM, running count ratio) at the top of the panel before tabular rows?
2. Why does `BulkEditDrawer` treat blank inputs as "leave unchanged", making it impossible to bulk-wipe an outdated owner or datacenter record?
3. What if bulk edit confirmation showed an exact visual diff preview of affected fields before execution?
