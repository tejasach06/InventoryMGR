---
name: InventoryMGR
description: Documentation inventory for VMs, storage, and physical infrastructure — precise, calm, trustworthy.
colors:
  accent: "#4f46e5"
  accent-hover: "#4338ca"
  surface: "#ffffff"
  surface-secondary: "#f6f7fb"
  surface-tertiary: "#eef0f7"
  border: "#e3e6ef"
  border-subtle: "#eef0f7"
  text-primary: "#0f1222"
  text-secondary: "#4a4f63"
  text-tertiary: "#9aa0b4"
  status-running: "#059669"
  status-suspended: "#d97706"
  status-decommissioned: "#dc2626"
  status-powered-off: "#64748b"
  criticality-critical: "#dc2626"
  criticality-high: "#ea580c"
  criticality-medium: "#d97706"
  criticality-low: "#059669"
  environment-production: "#4f46e5"
  environment-staging: "#7c3aed"
typography:
  display:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 1.5rem + 1.6vw, 2.75rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.12em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
    fontSize: "0.8125rem"
    letterSpacing: "-0.01em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  6: "24px"
  8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "20px"
---

# Design System: InventoryMGR

## 1. Overview

**Creative North Star: "The Instrument Panel"**

InventoryMGR is read by sysadmins mid-task, not browsed by visitors being sold something. The system takes its cue from an instrument panel: calm, neutral chrome everywhere, with color used only where it encodes a real reading — a VM's status, a host's criticality, an environment tier. Nothing on screen competes with that signal. The palette outside the semantic layer is deliberately quiet (near-white surfaces, slate-toned text, a single indigo accent for interactive elements), so that when a badge turns red or amber, it reads immediately as *meaning something*, not as decoration.

This explicitly rejects the bloated-enterprise-SaaS look — dense chrome, modal-on-modal flows, buried actions, decorative gradients. A two-second edit should never feel like a form wizard. Depth and motion are used the same way color is: sparingly, and only in response to state (hover, focus, a row revealing its actions), never as base decoration.

**Key Characteristics:**
- Neutral chrome, saturated signal — color is reserved for data meaning (status/criticality/environment/platform), never decoration
- Flat by default; elevation appears only on interaction (hover lift, focus ring, drawer/overlay)
- Dense information display (tables, badges, mono technical values) with enough breathing room to avoid feeling cramped
- Full light/dark parity — every semantic color has a tuned dark-mode counterpart, not just an inverted background

## 2. Colors

Restrained neutrals carry the interface; one indigo accent marks interactivity; a wide semantic palette (six categories × light/dark) carries all data meaning.

### Primary
- **Indigo Accent** (`#4f46e5`, hover `#4338ca`): links, primary buttons, focus rings, the one recurring brand touch (nav active state, logo mark). Used sparingly — it marks "you can act here," not "look here."

### Neutral
- **Surface** (`#ffffff`): card and table backgrounds.
- **Surface Secondary** (`#f6f7fb`): page background, alternating table rows.
- **Surface Tertiary** (`#eef0f7`): table headers, disabled fields, hover fills.
- **Border** (`#e3e6ef`): default hairline border on cards, tables, inputs.
- **Text Primary** (`#0f1222`): headings, primary content.
- **Text Secondary** (`#4a4f63`): labels, body copy.
- **Text Tertiary** (`#9aa0b4`): placeholders, help text, table header labels.

Dark mode is not an inverted primary; it's a separate tuned scale (slate-950 body, slate-900 cards, slate-100 text) with its own semantic-color pass — every status/criticality/environment/platform/os_family/lifecycle color gets a dedicated dark-mode value, not `opacity` or `invert()`.

### Named Rules
**The Signal Rule.** Saturated color appears only where it encodes a real, current data value — a VM's status, a host's criticality tier, an environment or platform badge. It never appears as page chrome, decoration, or emphasis-for-emphasis's-sake. If a color can't be traced to a specific field's value, it doesn't belong on screen.

## 3. Typography

**Display Font:** Space Grotesk (with ui-sans-serif, system-ui fallback)
**Body Font:** Inter (with ui-sans-serif, system-ui, -apple-system, "Segoe UI" fallback)
**Label/Mono Font:** ui-monospace / SF Mono, for IPs, hostnames, UUIDs, sizes, counts

**Character:** A geometric display face (Space Grotesk) paired with a humanist workhorse body face (Inter) — enough contrast to give headings a distinct, slightly technical presence without turning the whole interface geometric and cold.

### Hierarchy
- **Display** (600, `clamp(1.875rem, 1.5rem + 1.6vw, 2.75rem)`, 1.05 line-height, -0.015em tracking): page titles (`PageHeader`).
- **Title** (600, ~1.25rem): section headings, card titles, empty-state headings.
- **Body** (400, 0.875rem, 1.5 line-height): default UI text, table cells, form labels.
- **Label** (600, 0.6875rem, 0.12em tracking, uppercase): the `eyebrow-label` class — table column headers, section eyebrows. Used sparingly (see Don'ts).
- **Mono/Technical** (0.8125rem, tabular-nums, -0.01em tracking): IPs, hostnames, UUIDs, byte/GB values — anything meant to be scanned or compared column-wise.

### Named Rules
**The Tabular Rule.** Any value a user might scan down a column (IP address, size, count, UUID) gets `font-variant-numeric: tabular-nums` and the mono stack, so digits align vertically. Never render technical values in the body font.

## 4. Elevation

Flat by default. Cards, tables, and inputs sit at rest with only a 1px hairline border and a near-invisible ambient shadow (`shadow-raised`) — depth is not a resting state, it's a response to interaction: a bento tile lifts 2px on hover, a drawer/dialog uses `shadow-overlay` because it's transient and floating above content, row actions fade in on hover rather than always competing for space.

### Shadow Vocabulary
- **Raised** (`0 1px 2px rgba(15,18,34,.04), 0 4px 12px -4px rgba(15,18,34,.08)`; dark: `0 1px 2px rgba(0,0,0,.3), 0 4px 16px -4px rgba(0,0,0,.5)`): default resting state for cards, tables, stat tiles. Barely visible — a separation cue, not a decoration.
- **Overlay** (`0 8px 24px -6px rgba(15,18,34,.16), 0 2px 8px -2px rgba(15,18,34,.08)`; dark: `0 12px 32px -8px rgba(0,0,0,.6), 0 2px 8px -2px rgba(0,0,0,.4)`): drawers, dialogs, dropdowns — anything floating above the page.

### Named Rules
**The Flat-By-Default Rule.** Nothing gets a shadow just for existing. A card's shadow announces "this is a distinct region," not "this is important." Elevation increases only with genuine z-axis meaning: hover (lifted 2px), overlay (floating above content), never as a styling flourish on a static element.

## 5. Components

### Buttons
- **Shape:** rounded-lg (8px radius).
- **Primary:** indigo background (`#4f46e5`), white text, `px-4 py-2`, hover darkens to `#4338ca`. Reserved for the one primary action per view (Save, Create).
- **Secondary:** white/transparent background, 1px border, secondary text color, hover fills with surface-tertiary. Used for every non-primary action (Cancel, secondary nav actions).
- **Danger:** same shape as primary, background swapped to `criticality-critical` red — reserved for destructive actions (delete cluster, decommission).
- **Focus:** 2px accent-color ring, 2px offset, on every interactive element uniformly (buttons, links, inputs, selects) via a single global `:focus-visible` rule — never a component-specific focus treatment.

### Badges
- **Style:** rounded-md pill, semantic background + matching text color pulled from the six-category color system (status/criticality/environment/platform/os_family/lifecycle), plus a small solid dot repeating the same hue. `sm` size for dense table cells, `md` for card contexts.
- **State:** a subtle pop-in animation (`animate-pill-pop`) on mount/change, `hover:brightness-95` (dark: `brightness-110`) as the only interactive feedback — badges are informational, not clickable.

### Cards / Containers
- **Corner Style:** rounded-xl (12px).
- **Background:** white (dark: slate-900/70 with backdrop-blur).
- **Shadow Strategy:** `shadow-raised` at rest (see Elevation); no shadow increase unless the card is also a `bento-tile` (stat tiles), which lift 2px + increase shadow on hover.
- **Border:** 1px, `border/70` opacity — present but understated.
- **Internal Padding:** 20px (`p-5`).

### Inputs / Fields
- **Style:** rounded-lg, 1px border, white background, subtle ambient shadow.
- **Focus:** border shifts to accent color, 4px accent-tinted ring at 12% opacity (dark: indigo-400 at 15%) — soft glow, not a hard outline change.
- **Error:** `FieldError` renders below the field in `criticality-critical` red; the field itself does not get a red border (the message alone is the signal).
- **Disabled:** background steps to surface-tertiary, cursor `not-allowed`.

### Tables
- **Style:** sticky, backdrop-blurred header in surface-tertiary; odd/even row striping (white / surface-secondary at 60%); hover wash in accent color at 5% opacity.
- **Row actions:** hidden by default (`opacity-0`), fade + slide in only on row hover or keyboard focus-within on the actions themselves — never on focus of an unrelated element in the row (avoids two rows appearing "lit" simultaneously via a checkbox's focus).
- **Row accent (status color):** a 3px left border in the row's semantic status color, used exclusively on data rows to carry the Signal Rule — this is the one deliberate exception to a flat table design, and it exists only because the color *is* the data (a VM's actual status), never as generic emphasis.

### Navigation
- Fixed-position sidebar (`AppNav`); active route marked with the indigo accent, not a background fill. Bottom-anchored bulk-action bar slides up independently so it never collides with the sidebar.

## 6. Do's and Don'ts

### Do:
- **Do** reserve saturated color for the six semantic categories (status, criticality, environment, platform, os_family, lifecycle) — every other surface (nav, cards, chrome) stays neutral.
- **Do** keep shadows nearly invisible at rest (`shadow-raised`) and reserve `shadow-overlay` for genuinely floating surfaces (drawers, dialogs).
- **Do** use the mono/tabular-nums stack for any scannable technical value (IP, UUID, size, count).
- **Do** keep the primary button to one per view — the single action the screen wants you to take.
- **Do** hide row actions until hover/focus so tables stay dense and quiet until needed.

### Don't:
- **Don't** build a bloated-enterprise-SaaS interface — no dense chrome, no modal-on-modal flows, no burying the primary action behind menus.
- **Don't** use saturated color decoratively. If a color can't be traced to a real field value, it doesn't belong on screen.
- **Don't** add shadows to a static element "for depth." Shadow only increases in direct response to interaction or floating state.
- **Don't** add a second left-border color accent pattern outside the existing status-row convention — that one exception is load-bearing (it *is* the data), a second one would just be a stripe.
- **Don't** turn a routine two-second edit into a multi-step wizard or add a confirmation modal where none is currently required.
