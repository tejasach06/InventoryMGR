---
target: frontend/src/routes/VmDetailPage.tsx
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 1
timestamp: 2026-07-28T19-18-34Z
slug: frontend-src-routes-vmdetailpage-tsx
---
# Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Sub-resource additions/deletions occur without success toasts or live region feedback |
| 2 | Match System / Real World | 3 | Good sysadmin terms (vCPU, FQDN, SR-ID, VLAN), but sub-resource forms use generic labels |
| 3 | User Control and Freedom | 2 | Inline sub-resource deletions (`RemoveButton`) execute immediately on a single click without confirmation or undo |
| 4 | Consistency and Standards | 2 | Technical identifiers (`SR-ID`, `VM ID`, `FQDN`) lack monospace formatting; header eyebrow uses orange accent text |
| 5 | Error Prevention | 2 | Delete VM dialog protects record, but inline sub-resource deletions have zero safety guard or confirmation |
| 6 | Recognition Rather Than Recall | 2 | 13 stacked sections force users to recall which specific card holds a given field |
| 7 | Flexibility and Efficiency | 1 | No inline field editing for core specs; no one-click copy buttons for technical strings (IP, FQDN, VM ID) |
| 8 | Aesthetic and Minimalist Design | 2 | Clean dark theme foundation, but severe vertical sprawl across 13 cards; animated radar in `EmptyState` is decorative |
| 9 | Error Recovery | 2 | API errors display in red alert boxes, but present unformatted raw backend exception strings |
| 10 | Help and Documentation | 1 | Lacks tooltips or inline explanations for technical metrics (Health Score calculation, PMP Access) |
| **Total** | | **19/40** | **Needs Improvement (13-card sprawl, zero-confirmation deletes, no one-click copy)** |

## Design Specificity Verdict

**LLM Assessment**: Partial alignment with "Dark Instrument Panel" identity. The surface sits between an instrument panel and a generic 13-card SaaS CRUD viewer.
- **Token Drift & Signal Rule Violations**: `PageHeader` eyebrow displays `vm.environment` in orange accent text rather than using semantic environment badges. Technical attributes (IPs, FQDNs, SR-IDs) lack consistent mono tabular stack styling.
- **Missing Fast Ops Ergonomics**: No one-click copy buttons exist for IP addresses, FQDNs, or technical IDs. Core spec edits require full-page route transitions (`/edit`).

**Deterministic Scan**: 16 files scanned across target routes and components. 0 violations under default configuration; 1 warning under raw rules (`side-tab` on `ui.tsx`, line 54, confirmed false positive with inline waiver).

**Visual Overlays**: Live browser connection to dev server (port 5173) was not active during scan. Deterministic static regex analysis provided exact evidence.

## Overall Impression

`VmDetailPage` suffers from extreme vertical sprawl (13 stacked cards), lack of fast ops ergonomics (no copy buttons, no quick inline spec edits), and dangerous unguarded sub-resource deletions (`×` click deletes instantly).

## What's Working

1. **Robust Semantic Badge System**: The `Badge` component maps infrastructure attributes (`status`, `criticality`, `environment`, `platform`, `os_family`, `lifecycle`) directly to CSS variables with dot indicators.
2. **Keyboard-Accessible Confirmation Modals**: `ConfirmDialog` features proper focus trapping, `Escape` key listeners, `cancelRef` auto-focus, and backdrop blur for high-stakes actions.
3. **Structured Hardware Unit Formatting**: Uses `formatMemory()` and tabular numeric rendering for memory and CPU metrics.

## Priority Issues

### [P0] Unguarded Sub-Resource Deletion & Missing Quick Edits
- **Why it matters**: Sub-resource removal (`×` button on Disks, Networks, Applications) executes instantly on a single click without confirmation or undo. Updating core VM specs requires navigating away to `/inventory/${id}/edit`.
- **Fix**: Add inline confirmation to `RemoveButton`; enable quick drawer/modal editing for core VM specs directly from detail page.
- **Suggested command**: `/impeccable harden`

### [P1] Information Sprawl & 13-Card Layout Fragmentation
- **Why it matters**: Key operational metrics (IP, Hostname, Status, CPU/RAM, OS, Owner) are fragmented across 5 separate cards instead of presenting a unified "Instrument Panel" hero view.
- **Fix**: Consolidate layout into a Hero Operational Telemetry Card (IPs, Specs, Status, Health) + structured 2-column bento sections (Infrastructure, Governance, Audit Log).
- **Suggested command**: `/impeccable layout`

### [P2] Tabular & Technical Typography Violations
- **Why it matters**: Key technical fields (`FQDN`, `VM ID`, `SR-ID`, `VLAN`, `Gateway`) do not use `monoClass` or `tabular-nums`. Header eyebrow renders environment in accent orange text instead of a semantic badge.
- **Fix**: Apply monospace formatting to all technical strings; render environment as a semantic badge; align logo colors with dark neutral palette.
- **Suggested command**: `/impeccable typeset`

### [P3] Absence of Fast Ops Ergonomics (Copy-to-Clipboard)
- **Why it matters**: Sysadmins frequently inspect VM records to copy IPs or hostnames into terminal sessions or tickets. Manual text selection introduces friction and risks copy errors.
- **Fix**: Add subtle copy-to-clipboard buttons with instant feedback adjacent to IP addresses, FQDNs, and technical IDs.
- **Suggested command**: `/impeccable optimize`

## Persona Red Flags

- **Alex (Power User / Senior Sysadmin)**: Must scroll to Card 6 for IP addresses. No quick-copy button. Changing vCPU requires full route transition to `/edit`.
- **Jordan (First-Timer / Junior Ops)**: Clicking `×` next to a disk immediately deletes it from database without confirmation. 13 section jump links create navigation confusion.
- **Sam (Auditor / IT Security Admin)**: Audit log buried at bottom of 13th card. Security dates lack compliance indicators (e.g. warning for patches >90 days old). PMP/Backup/Monitoring render as plain text "Yes"/"No".

## Minor Observations

- `RemoveButton` relies on an ASCII `×` character rather than an SVG icon or explicit button styling.
- `DisksPanel` disk naming fallback (`disk${vm.disks.length}`) can generate duplicate names if items are removed out of order.
- `HealthScore` uses inline styles for CSS variables (`var(--color-status-running)`), but provides no breakdown of how the percentage score is computed.

## Questions to Consider

1. What if the VM detail header functioned as a real flight-deck instrument panel—synthesizing IP, status, hardware specs, OS, and health into a zero-scroll top display with one-click terminal copy actions?
2. Why does updating a single documentation field force a full page route transition (`/edit`), when sysadmins require instant, inline or drawer-based updates mid-incident?
3. How could the Audit Log transform from a buried table at the bottom of 13 cards into an interactive side-panel timeline?
