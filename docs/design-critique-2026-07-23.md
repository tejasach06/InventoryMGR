# InventoryMGR — Design Critique (All Pages)

**Date**: 2026-07-23
**Method**: dual-agent (A: design/heuristics review · B: grep-backed technical scan)
**⚠️ DEGRADED**: skill helper scripts (`detect.mjs`, `live-server.mjs`, `context.mjs`) live in the impeccable skill's virtual base directory, not reachable via Bash in this environment — so there's no automated slop detector run and no browser-injected overlay. Assessment B substitutes a manual grep-backed scan for the deterministic detector; Assessment A substitutes source reading for live browser inspection. Both ran as isolated parallel sub-agents per the skill's dual-assessment invariant.

Scope: 13 pages under `frontend/src/routes/` — LoginPage, DashboardPage, InventoryPage, ClustersPage, ClusterDetailPage, StoragePage, StorageDetailPage, VmDetailPage, VmFormPage, ImportCsvPage, ReportsPage, SettingsPage, UsersPage.

---

## Cross-Page Findings (read this first — repeats across 3+ pages)

### 1. Design-token migration is incomplete (P1, 5+ pages)
The recent "align X with design tokens" commit series (`7e41b99`, `8a207ee`, `213cba9`, `e20a511`, `9eb7bb2`) didn't reach every surface. A second, undeclared accent color competes with `var(--color-accent)` in several places:

| Hardcoded color | Should be | Location |
|---|---|---|
| `text-indigo-600`/`indigo-400` | `var(--color-accent)` | `ClustersPage.tsx:75`, `StoragePage.tsx:100` |
| `border/text-blue-600`/`blue-400` | `var(--color-accent)` | `SettingsPage.tsx:244,261` (tab active state) |
| `text-blue-600`/`blue-500`/`blue-400` | `var(--color-accent)` | `UsersPage.tsx:174` (new-user checkbox — **inconsistent with the same file's own `UserRow`/`UserCard` at lines 73/106**, which already use the token correctly) |
| `bg-rose-100`/`text-rose-700`/dark `rose-500/15`/`rose-300` | `var(--color-criticality-critical-bg)`/`var(--color-criticality-critical)` | `StoragePage.tsx:29-33` (`ThresholdBadge`) |
| Raw `text-red-600` for mutation errors | `Alert` component / criticality token | `ClustersPage.tsx:47,70`, `ClusterDetailPage.tsx:166,239`, `StorageDetailPage.tsx:147,180,212,239,295`, `VmDetailPage.tsx:122,167,203` |

Net effect: DESIGN.md's "one accent marks interactivity" rule is visibly broken in 3+ places, and the criticality-color system has an untokenized shadow copy for threshold badges.

### 2. `ClusterDetailPage.tsx` / `StorageDetailPage.tsx` are ~60-70% structurally duplicated (P1)
Both independently implement: header with Back/Delete + native `confirm()`, an editable Details/Capacity `SectionCard` toggling form↔view, a child-collection area with an always-open inline add-form, and per-row delete via `useMutation`+`invalidateQueries`. `StorageDetailPage.tsx` additionally reimplements `UsageBar` from scratch instead of reusing `StoragePage.tsx`'s version — two components, same name, slightly different markup, drift risk. Highest-leverage refactor in the codebase: one shared `EntityDetailShell` (header+delete+edit-toggle) + one shared `ChildCollectionEditor` (table+inline-add+remove) would remove this permanently.

### 3. Always-rendered inline add-forms break progressive disclosure (P1/P2)
`ClusterDetailPage`'s `NodeAddForm` (11 fields, 5 groups) and `StorageDetailPage`'s per-volume `InlineAddForm`×2 render fully expanded at all times — no toggle. This directly contradicts the list-page pattern (`ClustersPage`/`StoragePage`), where "+ New X" correctly gates the form behind a click. Compounds finding #2 — fixing the shared component fixes this too.

### 4. Banned pattern hit: side-stripe colored borders — `ImportCsvPage.tsx:183` (P1)
```
style={{ borderLeftColor: actionBorderColor[action], borderLeftWidth: '4px' }}
```
This is the one unambiguous violation of DESIGN.md's explicit "don't add a second left-border color accent pattern" rule (that device is reserved for table-row status only) — and the sole clear AI-slop-pattern hit across all 13 pages. Fix: swap for the `Badge` component already imported in the same file.

### 5. No unsaved-changes guard anywhere in the app (P0 on VmFormPage, P1 elsewhere)
No `beforeunload`/navigation guard exists on any form. Worst case: `VmFormPage.tsx` (40+ fields) loses everything on accidental back-navigation with zero warning. Also affects `ClusterDetailPage`'s `NodeAddForm` and `StorageDetailPage`'s inline add-forms. Directly undermines PRODUCT.md's stated goal ("nobody hesitates to update a record because the tool is faster than not bothering").

### 6. Dashboard + Reports silently cap aggregates at 200 VMs (P1)
`ALL_PARAMS = { limit: '200', offset: '0' }` in `DashboardPage.tsx:9` feeds vCPU/mem/disk totals AND `ReportsPage.tsx`'s bar-scale `max` — but Dashboard's "Total VMs" tile comes from a separate, real server total. Two numbers on the same screen can already disagree for any fleet over 200 VMs, with zero on-screen indication. Directly undermines the "what is true right now" trust promise.

### 7. No section/anchor nav on long pages (P1/P2)
`VmDetailPage` (12 `SectionCard`s) and `VmFormPage` (13 sections) both require scroll-hunting with no jump-nav, TOC, or default-collapsed low-frequency sections (Security, Audit Log, Record). One fix (sticky mini-TOC) resolves both.

### 8. `scope="col"` accessibility coverage is inconsistent on otherwise-identical tables (P2)
Present on `ImportCsvPage`/`UsersPage`, absent on `ClustersPage`/`StoragePage` — same markup pattern, not centralized into a shared `Table`/`Th` wrapper, so the fix doesn't propagate.

**Explicitly checked, not found**: gradient text, glassmorphism-as-default (the one dark-mode `backdrop-blur` on `cardClass` is elevation-driven, not decorative), numbered section markers (01/02/03), decorative uppercase eyebrows-as-filler (all instances found are functional labels), identical-card-grid-as-padding (Dashboard's stat tiles and Reports' 8 cards both carry genuinely distinct real data).

---

## Per-Page Detail

### LoginPage.tsx — 31/40 (Good)
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of Status | 3 | Loading state fine |
| 2 | Match Real World | 4 | n/a |
| 3 | User Control | 3 | No "forgot password" escape hatch |
| 4 | Consistency | 4 | n/a |
| 5 | Error Prevention | 3 | n/a |
| 6 | Recognition | 4 | n/a |
| 7 | Flexibility | 2 | No autofocus on email field |
| 8 | Aesthetic/Minimalist | 3 | Marketing aside contradicts "no persuasion" brand principle |
| 9 | Error Recovery | 3 | Doesn't distinguish wrong-password vs server-down language |
| 10 | Help/Docs | 2 | No support/docs link |
| **Total** | | **31/40** | |

Cognitive load: 0/8 failures (low). **AI-slop**: decorative gradient on `AuthShell` aside (lines 29-32) — but this is a known, already-accepted exception per commit `8a207ee`.

**Priority issues**:
- **[P1] Marketing copy panel contradicts DESIGN.md's own "no persuasion" principle.** Feature-bullet sales copy on an internal tool's login screen. Fix: replace with a quiet logo/tagline panel. → `/impeccable clarify`
- **[P2] No path for a locked-out user.** Fix: add "Contact your administrator to reset your password" line. → `/impeccable clarify`
- **[P3] No autofocus on email input.** → `/impeccable polish`

---

### DashboardPage.tsx — 34/40 (Good)
Cognitive load: 2/8 failures — 6 stat tiles in one row exceeds ≤4/group; 200-VM cap creates a working-memory gap (moderate).

**Priority issues**:
- **[P1] Aggregate math silently capped at 200 VMs** while "Total VMs" tile uses the real server total — numbers on the same screen can disagree. → `/impeccable harden`
- **[P2] 6 stat tiles in one row** breaks chunking guideline. Fix: split fleet-counts vs resource-totals into two groups. → `/impeccable layout`
- **[P3] `StatTile`/`Panel` reimplement card styling locally** instead of importing `cardClass`/`statTileClass`. → `/impeccable extract`

**Persona flag** — Alex: clickable vs static stat tiles are visually identical (no icon/underline distinguishing tiles with `href`).

---

### InventoryPage.tsx — 35/40 (Good)
Cognitive load: 2/8 failures — dense simultaneous surface (table + bulk bar + toolbar + filter drawer); 16 filter dimensions exceeds minimal-choices even split 4-core/12-advanced.

**Priority issues**:
- **[P1] "Select all" checkbox never reflects indeterminate state.** Users can't tell partial vs no selection. Fix: set `ref.indeterminate` via effect. → `/impeccable audit`
- **[P2] Sortable `<th>` lack `aria-sort`; sortable vs non-sortable columns look identical.** → `/impeccable accessibility` / `/impeccable audit`
- **[P2] Confirm advanced filters are truly collapsed by default** (not verified — `InventoryToolbar` not in the read set). → `/impeccable audit`
- **[P3] Bulk-selection counter isn't `aria-live`.** → `/impeccable audit`

---

### ClustersPage.tsx — 30/40 (Acceptable)
Cognitive load: 0/8 failures (low) — issues here are token/consistency, not load.

**Priority issues**:
- **[P1] Create-error uses raw `text-red-600`** instead of the `Alert` component used elsewhere on the *same page*. → `/impeccable polish`
- **[P2] Table `<th>` missing `scope="col"`.** → `/impeccable accessibility`
- **[P2] Name link hardcodes `text-indigo-600`** instead of `var(--color-accent)`. → `/impeccable polish`
- **[P3] Empty state is a bare sentence**, not the shared `EmptyState` component used on other pages. → `/impeccable polish`

---

### ClusterDetailPage.tsx — 30/40 (Acceptable)
Cognitive load: 4/8 failures (high) — `NodeAddForm` is 11 fields/5 groups always fully expanded; Details+Nodes+AddForm all compete on one page.

**Priority issues**:
- **[P0] `NodeAddForm` never validates non-empty `name` before submit** — a nameless physical-node record can be persisted silently. Directly undermines "always current, trustworthy" promise. → `/impeccable harden`
- **[P1] `NodeAddForm` always fully rendered** rather than progressive-disclosed. → cross-page finding #3, `/impeccable layout`
- **[P2] Native `confirm()` for delete** is inconsistent with the app's own design system. → `/impeccable polish`
- **[P2] Add-node error uses raw `text-red-600`** instead of `Alert`. → `/impeccable polish`

---

### StoragePage.tsx — 29/40 (Acceptable)
Cognitive load: 0/8 failures (low) — simple list page, issues are token/consistency.

**Priority issues**:
- **[P1] `ThresholdBadge` hardcodes rose colors** instead of the `criticality-critical` token. → cross-page finding #1, `/impeccable polish`
- **[P2] Name link hardcodes `indigo-600`.** → `/impeccable polish`
- **[P2] Table `<th>` missing `scope="col"`.** → `/impeccable accessibility`
- **[P3] `UsageBar` renders only an em-dash for `pct === null`** — inconsistent row weight. → `/impeccable polish`

---

### StorageDetailPage.tsx — 30/40 (Acceptable)
Cognitive load: 3/8 failures (high) — scales badly with volume count; add-forms always rendered.

**Priority issues**:
- **[P1] LUN/share/volume creation has no required-field validation** — `size_gb`/`capacity_gb` silently default to 0, `name` can be blank. Documentation-integrity problem. → `/impeccable harden`
- **[P1] All LUN/share add-forms always rendered per volume** — overwhelming for arrays with many volumes. → cross-page finding #3, `/impeccable layout`
- **[P2] `UsageBar` independently reimplemented here vs `StoragePage.tsx`** — same name, near-identical JSX, drift risk. → `/impeccable extract`
- **[P3] Cluster `<select>` has no inline "create new" escape hatch**, forces context-switch to Settings mid-task. → `/impeccable clarify`

---

### VmDetailPage.tsx — 33/40 (Good)
Cognitive load: 3/8 failures (high) — 12 sections stacked with no anchor nav, no collapse.

**Priority issues**:
- **[P1] No section anchor/jump nav on a 12-`SectionCard` page** — the single biggest usability tax for the app's stated power user (sysadmin doing this "constantly during real ops"). → cross-page finding #7, `/impeccable layout`
- **[P2] Combined clone/delete `Alert`** doesn't disambiguate which action failed. → `/impeccable clarify`
- **[P2] Independent per-panel invalidation** (Disks/Networks/Applications) risks visible reflow on rapid sequential edits. → `/impeccable optimize`
- **[P3] "Clone" has no preview/confirmation** of what gets copied. → `/impeccable clarify`

**Strength worth keeping**: `Field`/`HealthScore` pair color with text/number everywhere — no color-only encoding anywhere on this page.

---

### VmFormPage.tsx — 34/40 (Good)
Cognitive load: 2/8 failures (moderate-high, mitigated by good chunking) — 40+ fields in one continuous scroll, no jump-back-to-section after validation-scroll.

**Priority issues**:
- **[P0] No unsaved-changes guard on a 40+ field form.** → cross-page finding #5, `/impeccable harden`
- **[P1] No section anchor nav**, worse than the detail page since editing implies non-linear back-and-forth. → cross-page finding #7, `/impeccable layout`
- **[P2] `ComboInput` suggestion list isn't a real ARIA combobox** (no `role="listbox"`, no arrow-key nav). → `/impeccable accessibility`
- **[P3] No bulk/paste entry for disks or IPs** — manual row-by-row "+ Add" for what's often bulk provisioning data. → `/impeccable delight` (low priority)

**Strength worth keeping**: `vmFormSchema.safeParse` + scroll-to-first-error + focus is the strongest single error-prevention pattern found across all 13 pages. The `ponytail:` comment at line 310 is a good example of a documented, deliberate simplification.

---

### ImportCsvPage.tsx — 35/40 (Good — strongest page reviewed)
Cognitive load: 0/8 failures (low) — best-designed page in the set.

**Priority issues**:
- **[P1] Side-stripe colored border on summary tiles** (line 183) — the one clear banned-pattern hit in the app. → cross-page finding #4, `/impeccable polish`
- **[P2] Dropping a non-CSV file is silently ignored**, no feedback. → `/impeccable clarify`
- **[P3] No client-side pre-check for the stated 5 MiB/5000-row limits** before upload. → `/impeccable harden`

**Strengths worth keeping**: preview-before-commit with blocking-row detection wired to a disabled button + `aria-describedby` is the strongest error-prevention pattern in the app; contextual help text is the model other pages should copy.

---

### ReportsPage.tsx — 35/40 (Good)
Cognitive load: 0/8 failures (low).

**Priority issues**:
- **[P2] Shared progress-bar `max` computed across dissimilar units** (VM counts vs distinct-owner counts) — risks a misread of bar length as "low completion." → `/impeccable clarify`
- **[P3] "PMP" acronym never expanded.** → `/impeccable clarify`
- **[P3] Same 200-VM cap as Dashboard**, no visible indicator. → cross-page finding #6, `/impeccable harden`

---

### SettingsPage.tsx — 31/40 (Good)
Cognitive load: 2/8 failures (moderate) — two-color tab-active-state inconsistency undermines hierarchy; 7 tabs exceeds ≤4.

**Priority issues**:
- **[P1] Users/Notifications tabs use hardcoded blue instead of the accent token** used by the 5 adjacent category tabs — two different "active" colors in one tab strip. → cross-page finding #1, `/impeccable polish`
- **[P2] 7 tabs total; Users tab may duplicate the standalone `UsersPage.tsx` route.** Consider consolidating. → `/impeccable layout`
- **[P3] Row action buttons hidden behind hover-only** on a low-frequency admin page (density tradeoff more appropriate for Inventory than Settings). → `/impeccable audit`

**Strength worth keeping**: fully correct ARIA tab pattern (`role`, `aria-selected`, `aria-controls`) — best-in-class among all tabbed UIs reviewed.

---

### UsersPage.tsx — 31/40 (Good)
Cognitive load: 0/8 failures (low).

**Priority issues**:
- **[P1] No self-demotion/self-deactivation guard** — an admin editing their own row can set `role: 'viewer'` or `is_active: false` with no warning, a realistic self-lockout scenario. → `/impeccable harden`
- **[P2] "Active" checkbox in create-form hardcodes blue** while the same file's edit-row/edit-card checkboxes correctly use the accent token. → cross-page finding #1, `/impeccable polish`
- **[P3] Role names have no inline permission-scope description.** RBAC is central to this app's trust model per CLAUDE.md but isn't surfaced in the UI. → `/impeccable clarify`

**Strength worth keeping**: `sr-only` + per-id labels on the dense inline table is the strongest accessible-dense-table pattern among all 13 pages.

---

## Overall Impression

Design-token discipline is real but incomplete — the app clearly went through a deliberate migration pass and most pages show it, but ~5 pages still carry an undeclared second accent color and a shadow criticality-color system. The structural duplication between Cluster/Storage detail pages is the single highest-leverage cleanup available. The biggest *user-facing* risk isn't visual — it's the missing unsaved-changes guard on a 40+ field form and the two silent-undercount cases (Dashboard/Reports capped at 200 VMs) that directly contradict the product's "trustworthy, current" promise. `ImportCsvPage` and `VmFormPage`'s validation pattern are the two strongest things in the codebase — worth propagating rather than reinventing.
