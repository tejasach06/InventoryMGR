import { defineConfig, devices } from '@playwright/test';

const backendDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql+psycopg://inventorymgr@127.0.0.1:54329/inventorymgr_test';
const backendEnv = `APP_ENV=test DATABASE_URL="${backendDatabaseUrl}"`;
const resetDatabase = `uv run python -c "from sqlalchemy import create_engine, text; import os; engine = create_engine(os.environ['DATABASE_URL']); conn = engine.connect(); conn.execute(text('DROP SCHEMA public CASCADE')); conn.execute(text('CREATE SCHEMA public')); conn.commit(); conn.close(); engine.dispose()"`;
const backendCommand = [
  'cd ../backend',
  `${backendEnv} ${resetDatabase}`,
  `${backendEnv} uv run alembic upgrade head`,
  `${backendEnv} uv run uvicorn app.main:app --host 127.0.0.1 --port 8000`,
].join(' && ');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: backendCommand,
      url: 'http://127.0.0.1:8000/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'bun run dev',
      url: 'http://127.0.0.1:3000/login',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
