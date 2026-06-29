# Feedback 000 — Baseline (iteration 0)

Captured `gan-harness/shots/baseline/*` against the running dev stack (light + dark).

## Scores (weighted, threshold 7.5)
- Design Quality (0.35): **5.0** — clean and consistent but generic; lots of dead whitespace on login; flat depth.
- Originality (0.30): **3.0** — indistinguishable from a Tailwind admin starter; no brand identity, stock blue, plain wordmark.
- Craft (0.25): **5.0** — system font (no real typeface), native select chevrons, flat cards, minimal micro-interaction.
- Functionality (0.10): **9.0** — works in light + dark, responsive, all flows intact.
- **Weighted total: 4.68** → FAIL (gate not relevant; tests currently green).

## Observations
- Typography: default system sans everywhere — biggest single craft gap.
- Login: tiny centered card in a sea of empty space; faint top-left gradient; theme select floats awkwardly. Not memorable.
- Identity: "InventoryMGR" plain text, no logo mark, generic #2563eb blue.
- Inventory: functional table; loose spacing; plain filter bar; fine but characterless.
- VM detail: readable label/value grid; flat; "Identity & Placement" still says old section name (cosmetic, detail page only).
- Dark theme: solid, near-black; works.

## Top fixes for iteration 1
1. Add a real typeface via `next/font` (display + body) and wire through tokens.
2. Establish identity: logo mark + wordmark, refined accent + signature gradient, elevation system.
3. Reimagine login as a branded split hero (keep all form labels/buttons intact).
