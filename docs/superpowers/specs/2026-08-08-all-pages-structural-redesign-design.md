# InventoryMGR all-pages structural redesign

**Date:** 2026-08-08  
**Status:** Approved design  
**Scope:** All frontend routes and the shared application shell

## Objective

Refine every InventoryMGR page into a balanced technical instrument panel: compact where operators scan data, spacious where they make decisions, and trustworthy in every loading, empty, error, and success state. The redesign may reorganize page structure and navigation, but it must preserve existing capabilities, URLs, RBAC behavior, API contracts, URL-driven inventory state, light/dark parity, and per-user accent preferences.

The work stays within the current Next.js 16, React 18, Tailwind CSS 4, TanStack Query, and shared `src/components/ui.tsx` stack. It is a targeted redesign, not a framework migration or backend feature project.

## Approved direction

Use the **operational hubs** approach with balanced density.

The design keeps a collapsible desktop sidebar and reorganizes it into these groups:

- **Overview:** Dashboard, Reports
- **Inventory:** Virtual machines
- **Infrastructure:** Storage, Clusters
- **Operations:** Import
- **Administration:** Settings; Users and LDAP remain settings panels

Existing destinations remain addressable at their current URLs. The grouping changes navigation hierarchy, not routing or permissions.

## Design principles

1. **Trust before decoration.** A screen never claims a healthy or complete state while required data is loading or unavailable.
2. **One primary action per view.** Navigation, exports, cloning, and destructive actions are visually subordinate.
3. **Neutral chrome, semantic signal.** Accent indicates interaction. Saturated semantic colors represent actual status, criticality, environment, platform, OS family, or lifecycle values.
4. **Flat by default.** Dividers and neutral surface steps establish hierarchy. Overlay shadows are limited to transient or floating UI.
5. **Technical values scan as technical values.** Hostnames, addresses, identifiers, capacities, timestamps, and counts use the mono stack and tabular numerals.
6. **Progressive disclosure.** Long add forms, row editors, advanced actions, and destructive operations appear on demand.
7. **Responsive by design.** Mobile views prioritize identity, state, and the next action rather than shrinking desktop tables indiscriminately.

## Application shell

### Desktop

Retain the fixed, collapsible sidebar. Navigation groups use restrained sentence-case labels. The current route is indicated with accent text and a narrow marker over neutral chrome; a decorative accent-filled background is not required. Collapsed navigation retains an unambiguous active indicator and accessible labels.

The content region uses a centered wide frame. Inventory and other dense tables may use the full frame. Settings, authentication, and long forms use narrower readable measures. Sidebar transitions and content offsets remain synchronized.

### Mobile

Replace the fully expanded navigation inside the sticky header with a fixed-height app bar containing the brand, notifications, and a menu control. The menu opens a transient navigation panel containing grouped destinations, theme selection, user identity, and logout.

The mobile panel must:

- expose correct `aria-expanded` and dialog/navigation labels;
- trap focus while open;
- close on Escape, backdrop activation, route selection, and explicit close;
- restore focus to the trigger;
- lock background scrolling;
- respect reduced-motion preferences.

The real app-bar height remains the source for sticky section-navigation offsets.

### Page frame and headers

Authenticated pages share a consistent header model with optional breadcrumb, neutral context label, title, concise description, and actions. Detail-page “Back” controls become breadcrumb-style navigation above the title. Only one action receives primary styling. Destructive actions remain separated from routine editing.

## Shared component system

### Tokens and typography

Keep Geist and Geist Mono. Apply the documented body size and line height globally. Introduce tokens for any remaining neutral informational and scrollbar colors rather than raw palette literals. Retain existing semantic light/dark contrast guarantees.

Page eyebrows are neutral by default. A semantic value belongs in a `Badge`, not decorative page chrome. Progress indicators use explicit semantic colors or a neutral default instead of treating accent as generic data color.

### Surfaces

Reduce nested card usage. A top-level card may contain flat divided regions, compact inset rows, or tables, but not repeated full cards solely to create spacing. Static choice controls remain flat; drawers, menus, dialogs, sticky save trays, and mobile navigation use overlay elevation.

### Badges

Separate a badge’s visible label from its semantic token key. Supported mappings must be explicit:

- storage threshold warnings map to critical severity;
- import actions map intentionally to create, update, unchanged, conflict, and invalid states;
- active/inactive user state maps to running/powered-off semantics;
- user roles render as neutral outlined labels because roles are not infrastructure status values.

Unknown values fall back to a legible neutral treatment rather than unresolved CSS variables. Semantic badges use the documented rounded shape, subtle border, short entrance motion, and reduced-motion fallback.

### Overlays and focus

Use the global accent `:focus-visible` treatment consistently. Avoid simultaneous component ring and global outline treatments. Danger actions still use the accent focus indicator so keyboard focus remains uniform.

Drawers, action menus, confirmation dialogs, and mobile navigation share Escape handling, initial focus, focus containment, focus restoration, backdrop behavior, and scroll locking.

### Loading, empty, error, and success states

Loading states mirror final geometry: table skeletons for lists, summary-and-section skeletons for detail pages, and an auth-card skeleton for login setup checks. Large page-level empty states may use a composed surface and contextual action. Empty regions inside another surface use a compact, borderless inline state.

Errors remain inline, specific, and use `detailMessage`. Saved mutations produce calm visible confirmation where the result would otherwise be ambiguous. Raw server error messages are not exposed by global error surfaces.

## Page designs

### Login

Preserve the sanctioned animated login aside and reduced-motion behavior. Replace raw visual literals with tokens, add a mobile logo/wordmark, use responsive card padding, and reduce emphasis on unavailable LDAP login. Setup-status loading mirrors the final authentication card.

### Dashboard

Separate fleet counts from resource totals. Use clear title-tier panel headings instead of treating every title as metadata. Charts remain responsive and proportional; small categories must not visually overstate their share.

The operational banner waits for both fleet and storage status. It shows a neutral checking state while either source loads, a specific unavailable state when a required query fails, storage risk when thresholds are exceeded, and a healthy state only after successful confirmation. The normal-state inventory link is tertiary; risk remediation receives emphasis only when needed.

### Reports

Replace the repeated tall report-card grid with a compact catalogue. Each row contains report name, description, mono count, a coverage indicator only where the denominator is meaningful, and a download action. The owner report shows distinct-owner count without a misleading “of VMs” progress bar. Uncategorized coverage uses neutral color rather than decorative accent.

### Inventory

Retain the dense desktop table and URL-driven query state. Improve technical typography, `aria-sort`, partial-selection indication, status row marking, compact inline editing, and row-action discoverability. Consolidate CSV and Excel under one Export control so New VM is the sole primary action.

The bulk tray wraps safely on mobile and uses shared alerts and action primitives. Mobile inventory cards prioritize name, status, criticality, and resources; secondary environment, lifecycle, and OS metadata move to a quieter row to limit simultaneous signal color.

### VM detail

Use a breadcrumb, neutral “Virtual machine” context, one semantic telemetry region, Edit as the primary action, and a compact menu for Clone and Delete. Flatten nested telemetry tiles into a divided summary grid. Retain the section jump navigation.

Disks, networks, applications, and audit history use compact inline empty states. Child-row actions appear on hover and focus without becoming inaccessible to keyboard or touch users. Technical sizes, timestamps, identifiers, and change values use the mono stack.

### VM create/edit form

Keep the section jump navigation but consolidate related outer sections to reduce the card stack. Repeated disk and network rows receive clear grouping and appropriate field proportions. FQDN, VM IDs, storage IDs, IP data, and capacity inputs use technical typography.

Autocomplete suggestions become bounded overlay lists rather than changing document flow. The sticky action tray uses overlay elevation, communicates unsaved state, and right-aligns Save and Cancel. Existing unload/navigation protection remains intact and is tested.

### Storage list

Use a table-shaped skeleton and a contextual empty state with New array for authorized users. Each row shows a stable name baseline, capacity context, compact utilization, vendor/datacenter truncation, and a separately positioned threshold state. Technical capacity values remain mono and tabular.

### Storage detail

Move Back into a breadcrumb and make Edit the routine primary action. Replace the under-specified read view with a compact key/value summary for capacity, used space, vendor/model, datacenter, management host, description, and notes.

Volumes become quieter divided sections with a capacity meter and flat LUN/share subsections. Add forms use responsive grids with persistent labels and appear through progressive disclosure. Empty subsections use compact inline states; remove actions follow row-action visibility rules.

### Cluster list

Use a table-shaped skeleton, controlled description truncation, human-readable capacity units, and a contextual creation action in the empty state. Preserve current data and navigation contracts.

### Cluster detail

Move Back into a breadcrumb and separate Delete from routine actions. Replace the single-line details card with a summary region containing node count, total RAM, total storage, description, and notes where available.

Contain nodes, empty state, table, and add flow within one coherent section. Organize node creation into Identity and network, Compute, Capacity, and Location groups with responsive field widths. Normal capacity bars remain neutral unless real threshold data justifies warning color.

### CSV import

Make the full drop zone keyboard and pointer accessible. Show file type guidance and a distinct selected-file row with filename, size, and Clear. Convert the dense format reference into grouped rules and mono examples.

Use explicit workflow badge mappings. A committed preview retains full contrast; only unavailable controls become disabled. Humanize changed-field labels, keep batch identifiers compact and copyable, and make the wide preview deliberate on mobile through prioritized identity columns or expandable details.

### Settings

Use a standalone tab rail and a narrower page frame. Each panel owns its surface rather than nesting full cards inside a global card. Appearance choices use flat bordered targets with a clear selected state.

Notification preferences become setting rows with title and consequence on the left, compact control and Save on the right, and full-width feedback below. Successful saves receive confirmation.

### Users

Add panel hierarchy and a user count. Default desktop rows show email, neutral role, explicit active/inactive status, and one revealed Edit action. Only one row or drawer editor is open at a time. Mobile cards retain fit-content actions and communicate dirty state. The create form gives email/password more width than compact role/status controls.

### LDAP

Render explicit loading and failure states before the form. Group fields into Status, Connection, Directory search, Role mapping, and Transport security. Disabled LDAP visually de-emphasizes dependent fields while leaving the enable control clear.

Test connection becomes a separate neutral inset region with explanatory copy and a compact result. Feedback spans the available width rather than competing with buttons. Technical values use the mono font without downgrading input text contrast.

### Global error and not-found pages

The global error page presents one primary retry action, a tertiary route back to the dashboard, and a safe mono reference digest without exposing arbitrary raw errors. The not-found page uses a neutral static illustration and offers useful routes to Inventory and Dashboard.

## Data flow and functional constraints

No backend endpoints, schemas, RBAC rules, CSRF behavior, audit behavior, health calculations, or import/export formats change as part of this redesign. All requests continue through `src/api/client.ts`, and server state remains in TanStack Query.

Existing search, filter, sort, pagination, and column preferences remain URL- or preference-driven. Visual regrouping must not reset query state unexpectedly. Role-gated actions remain hidden or disabled according to existing authorization behavior, and server authorization remains authoritative.

## Implementation boundaries

Prefer focused shared primitives where repetition is already evident:

- responsive mobile navigation/overlay behavior;
- extended page header and breadcrumb treatment;
- compact inline empty state;
- explicit badge mapping/fallback;
- shared overlay accessibility behavior;
- reusable technical summary grids and setting rows where they remove real duplication.

Do not build a universal abstraction that erases meaningful differences among VM, storage, and cluster pages. Do not introduce a new icon or animation library. Do not change dependencies unless implementation proves an existing capability is insufficient.

## Testing and acceptance criteria

### Automated validation

- Existing Vitest route and component suites continue to pass.
- Add focused tests for mobile navigation state and accessibility, overlay focus behavior, badge mapping/fallback, dashboard checking/error/healthy truth states, compact empty states, user edit disclosure, and LDAP loading/failure states.
- Run frontend lint and TypeScript checks.
- Run responsive Playwright coverage at mobile, tablet, and desktop sizes for core navigation and representative list/detail/form pages.
- Update the graph index with `graphify update .` after implementation phases.

### Visual acceptance

- Light and dark modes remain legible and visually equivalent.
- No authenticated mobile page begins beneath a multi-row expanded navigation block.
- Each page has a clear primary action and restrained secondary controls.
- No unresolved badge CSS variables occur for current application values.
- Nested empty states and repeated mini-cards no longer dominate detail pages.
- Data color always corresponds to an actual semantic reading.
- Dense tables remain efficient on desktop and intentional on small screens.
- Reduced-motion mode removes nonessential movement without losing state communication.

## Rollout order

1. Shared tokens, badge behavior, focus, empty/loading primitives, and overlay accessibility.
2. Application shell, navigation grouping, mobile menu, and page frames.
3. Dashboard, Reports, and Inventory.
4. VM detail and VM form.
5. Storage and cluster list/detail pages.
6. Import, Settings, Users, LDAP, Login, global error, and not-found states.
7. Cross-page responsive and light/dark verification, then graph index refresh.
