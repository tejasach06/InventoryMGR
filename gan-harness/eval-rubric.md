# Evaluation Rubric — InventoryMGR UI/UX Refinement

Score each criterion 0–10. Weighted total = Σ(score × weight). **Pass threshold: 7.5.**
Evaluator mindset: *"Would this win a design award?"* over *"do all features work?"* —
but any functional/test/a11y regression is an automatic capped score (see Gate).

### Design Quality (weight: 0.35)
- Cohesive visual language: color, depth, spacing rhythm, typographic scale all feel deliberate.
- Strong visual hierarchy; the eye lands where it should on every page.
- Works beautifully in BOTH light and dark themes.

### Originality (weight: 0.30)
- Distinctive identity — not a stock slate+blue Tailwind admin template.
- Memorable moments (login, empty states, headers, accents) without gimmickry.
- Tasteful, product-grade creative choices (color, texture, motion, layout).

### Craft (weight: 0.25)
- Pixel-level polish: alignment, consistent radii/borders/shadows, balanced whitespace.
- Refined micro-interactions: hover, focus-visible, transitions, loading shimmer.
- Real typeface with proper weights, sizes, line-heights, tracking.

### Functionality (weight: 0.10)
- App still works end-to-end; nothing visually broken; responsive at mobile + desktop.

## Gate (hard rules — override the weighted score)
- If `bun run test` or the Playwright E2E suite fails → score is capped at **4.0** regardless of looks.
- If a theme (light or dark) is visibly broken → cap at **6.0**.
- If text contrast fails WCAG AA on primary content → cap at **6.0**.

## Scoring log
Each iteration appends to `gan-harness/feedback/feedback-NNN.md`:
- Per-criterion scores + weighted total
- What improved vs previous iteration
- Top 3 concrete fixes for the next iteration
- Gate status (tests pass? themes ok? contrast ok?)
