import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for running E2E tests against the Docker Compose stack.
 * Start the stack first, then point the tests at it:
 *
 *   docker compose up -d --build
 *   cd frontend
 *   npx playwright test --config=playwright.docker.config.ts
 *
 * No `webServer` block: Docker Compose provides the running services, so
 * Playwright neither starts nor resets them.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
