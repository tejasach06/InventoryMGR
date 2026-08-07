---
name: InventoryMGR
description: Documentation inventory for VMs, storage, and physical infrastructure — precise, calm, trustworthy.
colors:
  accent: "#f97316"
  accent-hover: "#ea580c"
  accent-text: "#c2410c"
  on-accent: "#1c0a00"
  on-danger: "#ffffff"
  surface: "#ffffff"
  surface-secondary: "#f6f7fb"
  surface-tertiary: "#eef0f7"
  surface-inverse: "#0f1222"
  text-inverse: "#ffffff"
  scrim: "rgba(0, 0, 0, 0.4)"
  border: "#e3e6ef"
  border-subtle: "#eef0f7"
  text-primary: "#0f1222"
  text-secondary: "#4a4f63"
  text-tertiary: "#6b7186"
  status-running: "#059669"
  status-decommissioned: "#dc2626"
  status-powered-off: "#64748b"
  criticality-critical: "#dc2626"
  criticality-high: "#ea580c"
  criticality-medium: "#d97706"
  criticality-low: "#059669"
  environment-production: "#f97316"
  environment-staging: "#7c3aed"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 1.5rem + 1.6vw, 2.75rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.12em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
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
    textColor: "{colors.on-accent}"
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

**Creative North Star: "The Dark Instrument Panel"**

InventoryMGR is read by sysadmins mid-task, not browsed by visitors being sold something. The system takes its cue from an instrument panel: deep pitch-black canvas, dark elevated surfaces, with vibrant orange used as the key interactive accent and color used where it encodes a real reading — a VM's status, a host's criticality, an environment tier. Nothing on screen competes with that signal.

This explicitly rejects the bloated-enterprise-SaaS look — dense chrome, modal-on-modal flows, buried actions, decorative gradients. A two-second edit should never feel like a form wizard. Depth and motion are used the same way color is: sparingly, and only in response to state (hover, focus, a row revealing its actions), never as base decoration.

**Key Characteristics:**
- Neutral chrome, saturated signal — color is reserved for data meaning (status/criticality/environment/platform), never decoration
- Flat by default; elevation appears only on interaction (hover lift, focus ring, drawer/overlay)
- Dense information display (tables, badges, mono technical values) with enough breathing room to avoid feeling cramped
- Full light/dark parity — every semantic color has a tuned dark-mode counterpart, not just an inverted background

## 2. Colors

Restrained neutrals carry the interface; one orange accent marks interactivity; a wide semantic palette (six categories × light/dark) carries all data meaning.

### Primary
- **Orange Accent** (`#f97316`, hover `#ea580c`): links, primary buttons, focus rings, the recurring brand accent (nav active state, logo mark). Used deliberately — it marks "you can act here."

### Neutral (Light Mode / Navy Dark Mode)
- **Surface** (`#ffffff` / dark `#0d1c2d`): card and table backgrounds.
- **Surface Secondary** (`#f6f7fb` / dark `#051424`): page background, alternating table rows.
- **Surface Tertiary** (`#eef0f7` / dark `#122131`): table headers, disabled fields, hover fills.
- **Border** (`#e3e6ef` / dark `#273647`): default hairline border on cards, tables, inputs.
- **Border Subtle** (`#eef0f7` / dark `#1c2b3c`): subtle inner borders.
- **Text Primary** (`#0f1222` / dark `#d4e4fa`): headings, primary content.
- **Text Secondary** (`#4a4f63` / dark `#909bb1`): labels, body copy.
- **Text Tertiary** (`#6b7186` / dark `#6b7a8f`): placeholders, help text, table header labels.

Dark mode is a dedicated navy scale (`#051424` page, `#0d1c2d` cards, `#d4e4fa` primary text) defined in `html.dark` in `globals.css` with a full semantic-color pass for every data category.

### Named Rules
**The Signal Rule.** Saturated color appears only where it encodes a real, current data value — a VM's status, a host's criticality tier, an environment or platform badge. It never appears as page chrome, decoration, or emphasis-for-emphasis's-sake. If a color can't be traced to a specific field's value, it doesn't belong on screen. Color reaches the DOM only through a `var(--color-*)` custom property. A raw Tailwind palette class (`bg-slate-900`, `text-red-600`) in `src/**` is a build error — see `frontend/eslint.config.mjs`. The two sanctioned literals are `src/app/icon.svg` (a standalone file with no CSS context) and the `.app-select` chevron data URI.
## 3. Typography

**Display & Body Font:** Geist (with ui-sans-serif, system-ui fallback)
**Label/Mono Font:** Geist Mono / ui-monospace / SF Mono, for IPs, hostnames, UUIDs, sizes, counts

**Character:** Geist provides a clean modern technical grotesque for both display headings and body copy across all density levels.
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
- **Primary:** `--color-accent` background (`#f97316` light / `#fb923c` dark), `--color-on-accent` (`#1c0a00`) text, `px-4 py-2`, hover `--color-accent-hover`. Reserved for the one primary action per view (Save, Create).
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
- **Focus:** border shifts to accent color, 4px accent-tinted ring at 12% opacity — soft glow, not a hard outline change.
- **Error:** `FieldError` renders below the field in `criticality-critical` red; the field itself does not get a red border (the message alone is the signal).
- **Disabled:** background steps to surface-tertiary, cursor `not-allowed`.

### Login Exceptions
The `/login` screen sits outside the main app shell and contains three deliberate exceptions to the general component guidelines:
1. **Glass Card (`authCardClass`):** Uses `backdrop-blur-xl` and 85% surface opacity on top of the mode-aware background surface (`shadow-overlay`).
2. **Underline Inputs (`authInputClass`):** Uses single border-bottom styling instead of the boxed `inputClass`. Focus-visible maintains a 2px accent outline ring with offset for WCAG compliance.
3. **Animated Aside (`.auth-gradient`):** Four-stop animated navy-to-orange gradient background (`#051424 → #122131 → #582200 → #f97316`), disabled and locked to a static navy frame under `prefers-reduced-motion: reduce`.

*None of these three exceptions may spread to in-app surfaces.*
### Tables
- **Style:** sticky, backdrop-blurred header in surface-tertiary; odd/even row striping (white / surface-secondary at 60%); hover wash in accent color at 5% opacity.
- **Row actions:** hidden by default (`opacity-0`), fade + slide in only on row hover or keyboard focus-within on the actions themselves — never on focus of an unrelated element in the row (avoids two rows appearing "lit" simultaneously via a checkbox's focus).
- **Row accent (status color):** a 3px left border in the row's semantic status color, used exclusively on data rows to carry the Signal Rule — this is the one deliberate exception to a flat table design, and it exists only because the color *is* the data (a VM's actual status), never as generic emphasis.

### Navigation
- Fixed-position sidebar (`AppNav`); active route marked with the orange accent, not a background fill. Bottom-anchored bulk-action bar slides up independently so it never collides with the sidebar.

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
- **Don't** pair a token class with a `dark:` palette override (`text-[var(--color-text-primary)] dark:text-slate-100`). The token already flips; the override reintroduces an off-system color.
