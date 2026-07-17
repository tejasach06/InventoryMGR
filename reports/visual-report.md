# Visual report — InventoryMGR

## Environment
- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- Docker: containers healthy
- Credentials: `admin@example.local` / `change-me-before-use`

## Playwright run status
Playwright could not execute in this environment.

Root cause:
- Playwright installed `chromium_headless_shell-1223`
- Launch failed with missing system libraries, including:
  - `libatk-1.0.so.0`
  - `libxkbcommon.so.0`
  - `libgbm.so.1`
  - `libX11.so.6`
- No package manager available in this shell, so `install-deps` could not complete.

## Artifacts produced
- Test script: `frontend/e2e/visual-report.spec.ts`
- Planned screenshots:
  - `reports/visual-desktop-default.png`
  - `reports/visual-desktop-presets-open.png`
  - `reports/visual-desktop-column-editor-open.png`
  - `reports/visual-desktop-filters-applied.png`
  - `reports/visual-tablet-default.png`
  - `reports/visual-tablet-presets-open.png`
  - `reports/visual-tablet-column-editor-open.png`
  - `reports/visual-tablet-filters-applied.png`
  - `reports/visual-mobile-default.png`
  - `reports/visual-mobile-presets-open.png`
  - `reports/visual-mobile-column-editor-open.png`
  - `reports/visual-mobile-filters-applied.png`

## Recommended fix
1. Install missing system libraries, for example:
   - `libatk1.0-0`
   - `libatk-bridge2.0-0`
   - `libxkbcommon0`
   - `libgbm1`
   - `libx11-6`
   - `libcups2`
   - `libxcb1`
   - `libxcomposite1`
   - `libxdamage1`
   - `libxfixes3`
   - `libxrandr2`
   - `libcairo2`
   - `libpango-1.0-0`
   - `libasound2`
   - `libatspi2.0-0`
2. Then rerun:
   - `cd frontend && BASE_URL=http://localhost:3000 npx playwright test e2e/visual-report.spec.ts`
3. Or use existing system Chrome/Chromium by setting `CHROME_PATH` and running with `frontend/playwright-headful.config.ts`.
