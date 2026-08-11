# Sidebar footer redesign

## Problem

`AppLayout` sidebar footer (`frontend/src/components/Layout.tsx`) stacks three
separate blocks divided by full-width hairlines: theme row, hairline, user
identity (avatar + email + role pill), hairline, full-width logout
button/row. Each divider does hierarchy work that type weight and grouping
should do instead. The role badge (bordered pill) visually competes with the
logout button for attention, and logout renders as a full-width row with the
same visual weight as the nav items directly above it.

Affects: expanded desktop sidebar footer (lines ~122-149), collapsed
sidebar footer (~150-166), and the mobile drawer footer (~96-101), which
currently duplicates the same stacked structure.

## Design

Collapse the three dividers/blocks into a single group under one
`border-t`, no new interaction paradigm (no popover/dropdown), no new
tokens.

**Expanded (desktop + mobile drawer):**
1. One `border-t border-[var(--color-border-subtle)] pt-4` wrapping the
   whole footer group (replaces the current two hairlines).
2. User row: `UserAvatarInitial` + email (truncate) + role as small muted
   text directly under the email — plain text, not the bordered pill badge.
3. Below the user row, one row containing `ThemeSegmented` (left) and an
   icon-only logout button (right), ghost style, turns
   `text-[var(--color-criticality-critical)]` on hover, matching the
   collapsed state's existing icon-only logout button.
4. No hairline between user row and theme/logout row — spacing (`gap`)
   carries the separation.

**Collapsed (desktop):**
Keep current avatar + icon-only logout stack; drop the small
`h-px w-8` divider between `ThemeSegmented` and avatar, use `gap-3` only.

**Mobile drawer footer:**
Mirror the same expanded-state treatment (single `border-t` group, role as
muted text not pill, theme+logout combined row) instead of its current
separate stacked layout, so mobile and desktop match.

**Tokens/patterns:** reuse only what's already in the file
(`--color-border-subtle`, `--color-surface-tertiary`,
`--color-criticality-critical`, `--color-criticality-critical-bg`,
existing `rounded-md`/`rounded-full` conventions). No new colors, radii, or
libraries.

## Out of scope

- No popover/dropdown user menu (considered, rejected: adds new
  interaction pattern beyond "polish + clarity" goal).
- No change to `AppNav` items above the footer.
- No change to header/mobile top bar.
