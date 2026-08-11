# Dark mode background: blue to gray

## Problem

Dark mode surfaces use dark-blue hexes (`#0d1c2d`, `#051424`, `#122131`). Goal: switch to neutral (hue-free) dark gray, same lightness levels, no other changes.

## Scope

- `frontend/src/app/globals.css`, `html.dark` block (~line 130-150):
  - `--color-surface`: `#0d1c2d` → `#1a1a1a`
  - `--color-surface-secondary`: `#051424` → `#0d0d0d`
  - `--color-surface-tertiary`: `#122131` → `#242424`
  - `--color-surface-inverse`: `#122131` → `#242424`
- `.auth-gradient` (~line 178): blue stops `#051424, #122131` → `#0d0d0d, #242424` (orange stops `#582200, #f97316` unchanged)

## Out of scope

- Text, border, accent, status, shadow, scrim vars — untouched.
- `accentPresets.ts` "blue" accent preset — user-selectable highlight color, unrelated to background.
- Light mode — unaffected.

## Verification

Visual check: toggle dark mode, confirm body/card/tertiary surfaces and auth page gradient read as neutral gray, no blue tint.
