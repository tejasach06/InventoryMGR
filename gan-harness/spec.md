# Design Brief — Refine InventoryMGR UI/UX

## One-line brief
Refine the UI/UX of the InventoryMGR frontend into a polished, distinctive, design-award-grade
virtual-machine inventory console — without breaking any existing functionality or tests.

## Context
InventoryMGR is a Next.js 16 (App Router) + Tailwind v4 admin app for managing VM inventory
(Proxmox/VMware). Backend is FastAPI. The current UI is a clean but generic slate+blue admin
dashboard: system fonts, flat cards, standard table, default form controls.

Surfaces (all under `frontend/src`):
- `app/globals.css` — Tailwind v4 `@theme` tokens + base styles (the design-token source of truth)
- `app/layout.tsx` — root layout (currently no custom font)
- `components/ui.tsx` — shared class tokens + primitives (buttons, inputs, card, table, Badge,
  Alert, EmptyState, Spinner, Skeleton, PageHeader, PageTransition)
- `components/Layout.tsx` / `components/AppNav.tsx` — collapsible sidebar shell + nav
- `components/ThemeProvider.tsx` — light/dark/system theme
- `routes/LoginPage.tsx`, `InventoryPage.tsx`, `VmDetailPage.tsx`, `VmFormPage.tsx`,
  `ImportCsvPage.tsx`, `SettingsPage.tsx`, `UsersPage.tsx`

## Goal
Elevate visual quality, craft, and a distinctive identity across the whole app. Highest leverage:
the centralized tokens in `globals.css` + `ui.tsx` + a real typeface in `layout.tsx` — changes there
propagate to every page with zero behavioral risk. Per-page polish (login hero, inventory density,
VM detail hierarchy, empty/loading states) layers on top.

## Hard constraints (non-negotiable)
1. **No functional regressions.** All existing unit tests (`bun run test`, 14) and Playwright E2E
   (`playwright.docker.config.ts`, 10) MUST stay green. Tests key off accessible names, labels,
   roles, ids, `.summary-card`, headings — preserve all of them.
2. **Light AND dark themes** both stay first-class; every change works in both.
3. **Accessibility preserved or improved** — focus rings, contrast (WCAG AA text), aria labels,
   keyboard paths unchanged.
4. **No new heavy dependencies** beyond a font (`next/font` is allowed; it is built in).
5. **Responsive** — mobile (stacked) and desktop (sidebar) layouts both remain usable.

## What "winning" looks like
A console that feels intentionally designed: confident typography, a cohesive and slightly
distinctive color/depth system, refined data density on the inventory table, a memorable login
screen, crafted micro-interactions (hover/focus/transitions), and polished empty/loading states —
recognizably a product, not a Tailwind starter.
