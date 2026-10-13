import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL;
if (process.env.INVENTORYMGR_E2E_RUNNER !== '1' || !baseURL || !process.env.TEST_DATABASE_URL) {
  throw new Error('Run just e2e or bash tools/run-rust-e2e.sh. Browser tests require the isolated runner.');
}

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--disable-dev-shm-usage', '--no-sandbox'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
});
