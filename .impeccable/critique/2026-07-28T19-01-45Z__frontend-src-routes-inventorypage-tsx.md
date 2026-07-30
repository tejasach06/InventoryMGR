---
target: frontend/src/routes/InventoryPage.tsx
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-07-28T19-01-45Z
slug: frontend-src-routes-inventorypage-tsx
---
# Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Search debounce lacks subtle pending spinner; bulk error obscures failed VM list |
| 2 | Match System / Real World | 4 | Excellent ops terminology (vCPU, FQDN, PMP, HA, Datacenter, Node, Cluster) |
| 3 | User Control and Freedom | 3 | Clear filter chips & column preferences, but lacks bulk edit rollback/undo |
| 4 | Consistency and Standards | 3 | Dark instrument panel parity, but mobile `VmCard` uses gray chips instead of semantic badges |
| 5 | Error Prevention | 3 | Double-submit confirmation for bulk edits >10 items, but export downloads immediately without count check |
| 6 | Recognition Rather Than Recall | 3 | Visible active filter chips, but staged bulk fields aren't highlighted until confirmation modal |
| 7 | Flexibility and Efficiency | 2 | No inline table cell editing for 2-second routine field updates; no keyboard shortcuts |
| 8 | Aesthetic and Minimalist Design | 3 | Dense dark instrument panel canvas, but filter bar container uses decorative orange gradient tint |
| 9 | Error Recovery | 2 | 0-result empty state is clean, but partial bulk edit failure conceals which specific records failed |
| 10 | Help and Documentation | 2 | Good drawer helper text, but lacks tooltips/microcopy for ops acronyms (PMP, HA, FQDN) |
| **Total** | | **28/40** | **Good (Solid baseline, key efficiency & recovery gaps)** |

## Design Specificity Verdict

**LLM Assessment**: High alignment with the "Dark Instrument Panel" identity — deep surface darks (`#111113`, `#09090b`), slate data rows, sticky glassmorphic table headers, and strict tabular mono typography for technical attributes. However, two key compromises weaken specificity:
1. **Signal Rule violation**: The filter bar surface uses an orange accent gradient tint (`color-mix(in srgb, var(--color-accent) 5%, var(--color-surface))`), breaking the rule that saturated color only encodes live data values.
2. **Missing core capability**: Product mission promises fast 2-second inline edits mid-task, yet the interface lacks inline cell editing, forcing multi-step drawer/modal interactions for single-field tweaks.

**Deterministic Scan**: 8 files scanned across target routes and components. 0 violations under default configuration. Under `--no-config` / raw rules, 1 warning detected: `side-tab` on `frontend/src/components/ui.tsx` (line 54, `rowAccent`).
- *False Positive Note*: The detector flag on `rowAccent` is a confirmed false positive. It renders a 3px left status color border on table rows to communicate live VM status (running/suspended/decommissioned). Line 54 already has an explicit inline ignore comment `/* impeccable-disable-line side-tab -- data row status border */`.

**Visual Overlays**: Live browser connection to dev server (port 5173) was not active during scan. Deterministic static regex analysis provided exact evidence.

## Overall Impression

InventoryMGR's primary inventory surface is a clean, dark, highly readable instrument panel. The typography, row striping, status border accents, and dense data layouts match the mental model of sysadmins and IT ops staff. The core shortcomings are functional efficiency (lack of inline cell editing), recovery clarity (opaque partial bulk update failures), and minor adherence to the Signal Rule on page chrome.

## What's Working

1. **Instrument Panel Technical Typography**: Strict pairing of Space Grotesk display headers with tabular mono stack (`tech`, `tabular-nums`) for IPs, node names, health scores, and storage sizes.
2. **Sticky Table Header & Semantic Row Accent**: Desktop `VmTable` combines a sticky blurred glass header (`backdrop-blur`) with 3px left semantic status borders (`rowAccent`), allowing rapid vertical scanning without visually cluttering table cells.
3. **Contextual Bulk Action Bar**: Bottom-anchored floating bar appears smoothly upon row selection, displaying exact selection counts, instant export triggers, and batch edit drawer launchers.

## Priority Issues

### [P1] Missing Fast Inline Cell Editing
- **Why it matters**: Product mission promises *\"Nobody hesitates to update a record because the tool is faster than not bothering... fast edits stay fast.\"* Currently, updating a single field (e.g., Owner, Status, or Environment) forces opening a drawer or navigating to the detail page.
- **Fix**: Implement click/double-click inline cell editing directly in `VmTable` for text and select fields with keyboard commit (`Enter`) / cancel (`Esc`).
- **Suggested command**: `/impeccable optimize`

### [P1] Opaque Partial Bulk Update Failure Recovery
- **Why it matters**: When a bulk update succeeds for some VMs but fails for others, the alert states `\"X updated, Y failed\"` without identifying which specific VMs failed or why. In high-stakes ops, this leaves infrastructure documentation in an un-auditable state.
- **Fix**: Expand the error alert to display a collapsible list of failed VM names, IDs, and server validation messages, plus a "Select Failed VMs" quick-retry button.
- **Suggested command**: `/impeccable harden`

### [P2] Signal Rule Violation on Filter Bar Surface
- **Why it matters**: `filterBarClass` in `ui.tsx` applies an orange accent gradient tint (`color-mix(in srgb, var(--color-accent) 5%, var(--color-surface))`). This breaks the core rule: *\"Saturated color appears only where it encodes a real, current data value... It never appears as page chrome or decoration.\"*
- **Fix**: Remove the orange gradient tint from `filterBarClass`; revert background to neutral `surface-tertiary` or dark slate with standard hairline border.
- **Suggested command**: `/impeccable quieter`

### [P2] Inconsistent Status Badges on Mobile Cards
- **Why it matters**: `VmCard` (mobile layout) renders status, criticality, environment, and lifecycle as generic gray chips (`neutralChipClass`) rather than semantic colored badges (`Badge`). Mobile users lose key visual status cues (running green, suspended orange, decommissioned red).
- **Fix**: Replace `neutralChipClass` spans in `VmCard` with `<Badge value={...} type="..." size="sm" />`.
- **Suggested command**: `/impeccable colorize`

### [P3] Overwhelming Form Density in Bulk Edit Drawer
- **Why it matters**: `BulkEditDrawer` displays 16+ form fields across 4 fieldsets simultaneously, requiring heavy scrolling and increasing cognitive load when staging bulk updates.
- **Fix**: Add tabbed/accordion grouping for fieldsets, or show a sticky header summary of modified/staged fields.
- **Suggested command**: `/impeccable layout`

## Persona Red Flags

- **Alex (Power User / Sysadmin)**: Cannot edit table cells inline; no keyboard shortcuts (`cmd+a` to select all, `/` to search, `e` to edit); page size capped at 200 without continuous scroll.
- **Jordan (First-Timer / Junior Tech)**: Opening Filter Drawer exposes 15 un-grouped technical dropdowns at once; ops acronyms (PMP, HA) lack inline tooltips; risk of triggering bulk actions on un-rendered items off-screen.
- **Sam (Auditor / IT Ops Lead)**: Partial bulk update failures hide failure reasons and list of un-updated VM IDs; CSV export button triggers direct download without confirming record count or column selection scope.

## Minor Observations

- Search input 400ms debounce lacks a subtle inline loading spinner during network request windows.
- Table header column sort buttons lack distinct focus ring separation on dark mode.
- Mobile `VmCard` lacks quick inline row action buttons available on desktop.
- `PaginationFooter` row selector dropdown lacks explicit max-width when table container stretches.

## Questions to Consider

1. Why is inline cell editing absent from an infrastructure documentation tool built for "two-second edits mid-task"?
2. If orange accent represents interactivity and signal, why does decorative gradient tinting contaminate the filter bar container?
3. How can sysadmins trust bulk ops when failure alerts conceal which infrastructure records were rejected?
