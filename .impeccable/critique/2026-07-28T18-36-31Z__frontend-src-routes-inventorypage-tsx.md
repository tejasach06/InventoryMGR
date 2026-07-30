---
target: frontend/src/routes/InventoryPage.tsx
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-07-28T18-36-31Z
slug: frontend-src-routes-inventorypage-tsx
---
Method: dual-agent (A: AssessmentA_DesignReview · B: AssessmentB_DetectorBrowser)

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Bulk outcomes render in red error Alert; search lacks loading indicator |
| 2 | Match System / Real World | 1 | Domain terms accurate but status text lacks semantic color badges |
| 3 | User Control and Freedom | 2 | Staged filter drawer good; missing safety confirmation on mass fleet edits |
| 4 | Consistency and Standards | 2 | Missing `rowAccent` status borders mandated by DESIGN.md; invalid `role="grid"` |
| 5 | Error Prevention | 3 | High risk: zero confirmation modal before applying bulk edits across thousands of VMs |
| 6 | Recognition Rather Than Recall | 1 | Active filter chips clear; active filter counts helpful |
| 7 | Flexibility and Efficiency | 2 | Good search/filter URL persistence; missing ops keyboard shortcuts (`/`, `Esc`) |
| 8 | Aesthetic and Minimalist Design | 2 | Header action button clutter; 19-field form wall in BulkEditDrawer |
| 9 | Error Recovery | 2 | Generic API error messages; lack of per-VM failure breakdown on partial bulk edit |
| 10 | Help and Documentation | 3 | Missing inline help/tooltips for advanced query filters and tag syntax |
| **Total** | | **20/40** | **Operational Fixes Required** |

### Design Specificity Verdict

**LLM assessment**: InventoryPage.tsx has strong URL-driven filter/sort architecture, but drifts from "The Dark Instrument Panel" design system by dropping `rowAccent` status left borders on table rows and rendering status/criticality as plain text spans instead of semantic Badges. The bulk drawer presents a 19-field form wall, and top action buttons duplicate export controls.

**Deterministic scan**: Automated detector scanned `frontend/src` and reported 4 issues:
- `bounce-easing` in `globals.css:32` (warning)
- `codex-grid-background` in `globals.css:295` (advisory)
- `border-accent-on-rounded` in `ColumnDrawer.tsx:81` (warning)
- `side-tab` in `ui.tsx:54` (warning)

**False positive analysis**: `side-tab` in `ui.tsx:54` (`borderLeft: 3px solid ...`) is a verified **false positive**. `DESIGN.md` explicitly mandates the 3px left status-accent border on table data rows as a load-bearing exception to flat styling (The Signal Rule).

**Visual overlays**: Automated detector script ready. Headless Chromium browser device (`xd://browser`) verified functional for overlay injection.

### Overall Impression

Solid technical architecture with URL-grounded filter/sort state, but violates core design rules ("The Signal Rule", `rowAccent` status borders) and presents dangerous UX gaps (unshielded bulk edits, successful bulk ops rendering inside red error banners).

### What's Working

1. **URL-Grounded State**: Filter, sort, pagination, and search query stay in sync with URL searchParams.
2. **Responsive Dual Grid**: Dense `VmTable` desktop layout paired with clean `VmCard` bento cards on mobile.
3. **Column Customization**: Drag-and-drop column reordering and visibility toggling via `ColumnDrawer`.

### Priority Issues

- **[P0] Dangerously Unshielded Mass Bulk Edit**:
  - **Why it matters**: Bulk updates targeting "All matching VMs" execute instantly upon drawer submit without confirmation modal. High risk of accidental mass data corruption.
  - **Fix**: Require `ConfirmDialog` when `selectAllMatching` is enabled or target count > 10.
  - **Suggested command**: `/impeccable harden`
- **[P1] Violation of "Signal Rule" & Missing Status Row Accent Borders (`rowAccent`)**:
  - **Why it matters**: `DESIGN.md` mandates a 3px status left border on data rows. `VmTable` renders status/criticality as plain text spans, preventing rapid visual ops scanning.
  - **Fix**: Add `rowAccent('status', vm.status)` to table rows, and render semantic `<Badge>` components.
  - **Suggested command**: `/impeccable colorize`
- **[P1] Misleading Red Error Alert for Successful Bulk Edits**:
  - **Why it matters**: Successful bulk operations invoke `setBulkError(...)`, displaying success output inside a red error `<Alert>`.
  - **Fix**: Separate `bulkSuccess` and `bulkError` state; render successful bulk edits in green `<Alert tone="success">`.
  - **Suggested command**: `/impeccable clarify`
- **[P2] ARIA Accessibility Violation (`role="grid"`)**:
  - **Why it matters**: `VmTable` uses `role="grid"` without arrow key cell navigation, confusing screen readers.
  - **Fix**: Remove `role="grid"` or add full ARIA keyboard cell navigation.
  - **Suggested command**: `/impeccable audit`
- **[P3] Header Button Clutter & Duplicate Export Controls**:
  - **Why it matters**: Header renders permanent CSV/Excel buttons while Bulk Bar also renders CSV/Excel export buttons.
  - **Fix**: Consolidate header export controls into a single split dropdown.
  - **Suggested command**: `/impeccable distill`

### Persona Red Flags

- **Alex (Sysadmin Power User)**: Cannot scan table for failing/suspended hosts due to missing status left-border accent and plain-text status. Lacks keyboard shortcuts (`/`, `Esc`).
- **Jordan (First-Timer IT Ops)**: High risk of mass accidental VM edit without confirmation step. Panics when successful bulk update displays inside red Error Alert.
- **Taylor (Compliance Auditor)**: Mobile view strips semantic color data (gray chips for criticality/environment). No change audit summary provided after bulk ops.

### Minor Observations

- Bounce easing in `globals.css:32` feels tacky.
- Decorative grid-line background in `globals.css:295`.
- `border-t-2` on rounded header in `ColumnDrawer.tsx:81`.
- Search input missing spinner during 400ms debounce.

### Questions to Consider

- Why expose 19 bulk fields simultaneously when 90% of updates target status or owner?
- Why no quick inline status dropdown directly on inventory table rows?
