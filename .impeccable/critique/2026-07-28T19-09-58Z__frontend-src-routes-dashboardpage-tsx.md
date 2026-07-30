---
target: frontend/src/routes/DashboardPage.tsx
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-07-28T19-09-58Z
slug: frontend-src-routes-dashboardpage-tsx
---
# Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Storage alerts lack signal color when >0; truncation disclaimer subtle; single query error wipes view |
| 2 | Match System / Real World | 2 | Donut chart uses generic "MACHINES" label; BarList displays max-relative bars instead of fleet percentages |
| 3 | User Control and Freedom | 2 | Stat tiles link to filtered inventory views, but lacks inline dashboard filters or notification dismiss actions |
| 4 | Consistency and Standards | 1 | Violates DESIGN.md tokens: hardcoded Tailwind slate/zinc/orange classes instead of CSS variables; 6 tiles in 5-col grid |
| 5 | Error Prevention | 3 | Read-only dashboard limits destructive actions, but 200 VM sample size disclaimer easy to miss |
| 6 | Recognition Rather Than Recall | 2 | Bar charts lack percentage breakdowns; criticality bars rely on text names without semantic color indicators |
| 7 | Flexibility and Efficiency | 2 | Quick links to filtered views provided, but lacks dashboard search bar, customizable layout, or quick actions |
| 8 | Aesthetic and Minimalist Design | 2 | Clean card layout, but fails "Dark Instrument Panel" identity; repeating truncation hints add visual noise |
| 9 | Error Recovery | 1 | Single API query failure renders full-page error banner; no per-panel error boundaries or retry options |
| 10 | Help and Documentation | 1 | No tooltips explaining capacity calculation logic (allocated vs actual disk space) or 200 VM truncation rules |
| **Total** | | **18/40** | **Needs Improvement (Token drift, extraneous load, grid mismatch)** |

## Design Specificity Verdict

**LLM Assessment**: Low alignment with "Dark Instrument Panel" identity. Implementation relies heavily on hardcoded Tailwind slate cards (`border-slate-200/70`, `dark:bg-slate-900/60`), bypassing semantic CSS variables (`var(--color-surface)`, `var(--color-border)`).
- **Token Drift**: `AppNav.tsx` uses `dark:bg-zinc-800/50` and Tailwind `bg-orange-500/10 text-orange-500` instead of CSS variables (`var(--color-accent)`).
- **Signal Rule Violation**: Orange accent color is applied decoratively to VM links in "Recently added", violating the rule that color is reserved strictly for data state. Meanwhile, critical "Storage alerts" display plain neutral digits even when `arraysOverThreshold > 0`.

**Deterministic Scan**: 16 files scanned across target routes and components. 0 violations under default configuration; 3 violations detected under raw rules (false positives in table status row accent borders).

**Visual Overlays**: Live browser connection to dev server (port 5173) was not active during scan. Deterministic static regex analysis provided exact evidence.

## Overall Impression

The Dashboard functions as a passive reporting page rather than an active, high-craft telemetry console. Extraneous cognitive load (200 VM truncation disclaimers, grid wrapping mismatches, un-highlighted storage alerts) obscures vital infrastructure status cues.

## What's Working

1. **Direct Filter Deep-Links**: Stat tiles and distribution bars directly link to pre-filtered `/inventory` views (e.g. `/inventory?environment=production`), accelerating ops navigation.
2. **Tabular Numerics**: Technical values (vCPU cores, RAM, Disk, counts) consistently use tabular numerals (`tech` / `monoClass`), ensuring vertical scanning efficiency.
3. **Structured Skeleton Loaders**: Loading state utilizes matching grid skeleton placeholders for stat tiles and breakdown panels, avoiding layout shifts during data fetching.

## Priority Issues

### [P0] Truncation Disclaimer Noise & Misrepresented Ratios
- **Why it matters**: Client-side 200-VM fetch limit causes capacity metrics to reflect partial data, adding disclaimer text and 4 repeating hints. BarList scales width via `Math.max()` instead of true fleet percentage, misrepresenting category scale.
- **Fix**: Update BarList to display percentage of total fleet; replace repeated tile hints with a single unified status header banner.
- **Suggested command**: `/impeccable clarify`

### [P1] Dilution of "Dark Instrument Panel" & Signal Rule Violations
- **Why it matters**: Hardcoded Tailwind colors (`slate-*`, `zinc-*`, `orange-500`) bypass CSS design tokens (`var(--color-surface)`, `var(--color-accent)`). Decorative accent tinting on VM links violates Signal Rule, while critical Storage Alerts fail to highlight red when thresholds are breached.
- **Fix**: Refactor hardcoded colors to semantic design tokens; remove accent color from decorative links; apply `var(--color-criticality-critical)` highlight to Storage Alerts when `arraysOverThreshold > 0`.
- **Suggested command**: `/impeccable colorize`

### [P1] Broken Stat Tile Grid Layout & Asymmetric Spacing
- **Why it matters**: Dashboard displays 6 stat tiles in an `xl:grid-cols-5` grid, forcing "Storage alerts" tile to drop onto row 2 alone and creating awkward whitespace.
- **Fix**: Reorganize stat tiles into a balanced 6-column grid (`xl:grid-cols-6`) or structured bento grid.
- **Suggested command**: `/impeccable layout`

### [P2] Fragile Error Handling & Lack of Resilient Recovery
- **Why it matters**: Single API failure (`statsQ` or `vmsQ`) triggers a full-page Alert banner, hiding all working panels and preventing admins from viewing storage alerts or partial stats.
- **Fix**: Implement per-panel error boundaries with explicit "Retry" buttons.
- **Suggested command**: `/impeccable harden`

### [P2] Missing Fleet Health Hero Signal & Uncalibrated Notification Bell
- **Why it matters**: Lacks high-level fleet status banner ("Fleet Operational"), while urgent decommission notifications are isolated in top-right `NotificationBell.tsx`.
- **Fix**: Add high-level status banner; integrate urgent decommission/storage alerts onto main Dashboard surface.
- **Suggested command**: `/impeccable delight`

## Persona Red Flags

- **Alex (Power User / Senior Sysadmin)**: Capacity metrics (vCPU, RAM, Disk) capped at first 200 VMs (`limit=200`). Storage alerts tile displays neutral styling even when threshold exceeded. No keyboard shortcuts.
- **Jordan (First-Timer / Junior IT Admin)**: Misled by BarList progress bars (100% bar means max category count, not 100% of fleet). Inconsistent terminology ("MACHINES" vs "VMs"). Storage alerts tile redirects to `/storage` while other tiles redirect to `/inventory`.
- **Sam (Auditor / IT Compliance Officer)**: Reads 4 separate capacity tiles marked with ambiguous `hint="of first 200 VMs"`. Unable to copy clean summary metrics or export reports. Lacks exact percentage figures for criticality and environment distributions.

## Minor Observations

- SVG Donut uses fixed 168x168 viewBox and hardcoded inline text styles, impairing fluid visual scaling across breakpoints.
- Recently added dates formatted via `toLocaleDateString('en-CA')` (YYYY-MM-DD); ISO standard good, but lacks relative timestamp ("2 days ago").
- `AppNav.tsx` uses `dark:bg-zinc-800/50` while `ui.tsx` and `DashboardPage.tsx` use `dark:bg-slate-900`, creating dark-mode color inconsistency.
- `NotificationBell.tsx` triggers immediate `ackDecommissions()` mutation on panel open, auto-clearing unread count before user reviews list items.

## Questions to Consider

1. What if the Dashboard functioned as an active Telemetry Console—displaying live health indicators and immediate alert actions—rather than a passive static reporting page?
2. How might we eliminate client-side VM list truncation (200 VM cap) so capacity metrics (vCPU/RAM/Storage) always reflect 100% accurate server-aggregated metrics?
3. Why are urgent decommission notifications trapped inside a floating header bell when they represent critical infrastructure lifecycle events that belong front-and-center on the ops overview surface?
