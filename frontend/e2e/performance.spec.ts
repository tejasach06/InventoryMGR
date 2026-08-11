import { expect, Page, Response, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const warmups = 3;
const samples = 15;
const routes = ['/dashboard', '/reports', '/inventory'] as const;

const defaultAdminEmail = process.env.INVENTORYMGR_INITIAL_ADMIN_EMAIL ?? 'admin@example.local';
const defaultAdminPassword = process.env.INVENTORYMGR_INITIAL_ADMIN_PASSWORD ?? 'change-me-before-use';
const perfAdminEmail = 'perf-admin@example.com';
const perfAdminPassword = 'correct horse battery staple';

type RouteResult = {
  durations_ms: number[];
  transfer_bytes: number[];
  median_duration_ms: number;
  median_transfer_bytes: number;
};

async function tryLogin(page: Page, email: string, password: string): Promise<boolean> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  try {
    await expect(page).toHaveURL(/\/inventory$/, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function authenticateOnce(page: Page) {
  await page.goto('/login');
  const setupButton = page.getByRole('button', { name: 'Create admin account' });
  const signInButton = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(setupButton.or(signInButton)).toBeVisible();
  if (await setupButton.isVisible()) {
    await page.getByLabel('Email').fill(defaultAdminEmail);
    await page.getByLabel('Password', { exact: true }).fill(defaultAdminPassword);
    await page.getByLabel('Confirm password').fill(defaultAdminPassword);
    await setupButton.click();
    await expect(page).toHaveURL(/\/inventory$/);
    return;
  }
  if (await tryLogin(page, defaultAdminEmail, defaultAdminPassword)) {
    return;
  }
  await page.goto('/login');
  if (await tryLogin(page, perfAdminEmail, perfAdminPassword)) {
    return;
  }
  throw new Error('Could not authenticate with default or performance admin credentials');
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function measuredGoto(page: Page, route: string, baseURL: string) {
  const sameOrigin = new URL(baseURL).origin;
  const responses: Response[] = [];
  const collect = (response: Response) => responses.push(response);
  page.on('response', collect);
  try {
    await page.goto(route, { waitUntil: 'networkidle' });
  } finally {
    page.off('response', collect);
  }
  const duration = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return navigation?.duration ?? 0;
  });
  let transferBytes = 0;
  for (const response of responses) {
    const url = new URL(response.url());
    if (url.origin !== sameOrigin) continue;
    const contentType = response.headers()['content-type'] ?? '';
    const pathname = url.pathname;
    const included =
      pathname.startsWith('/api/') ||
      contentType.includes('javascript') ||
      contentType.includes('css') ||
      contentType.includes('text/html') ||
      contentType.includes('application/json');
    if (!included) continue;
    try {
      transferBytes += (await response.body()).byteLength;
    } catch {
      // Cached or aborted responses may not expose a body; they also did not add bytes here.
    }
  }
  return { duration, transferBytes };
}

test('records production route performance', async ({ page, baseURL }) => {
  const output = process.env.PERF_OUTPUT;
  expect(output, 'PERF_OUTPUT is required').toBeTruthy();
  expect(baseURL, 'baseURL is required').toBeTruthy();
  await authenticateOnce(page);

  const results: Record<string, RouteResult> = {};
  for (const route of routes) {
    for (let i = 0; i < warmups; i++) {
      await measuredGoto(page, route, baseURL!);
    }
    const durations_ms: number[] = [];
    const transfer_bytes: number[] = [];
    for (let i = 0; i < samples; i++) {
      const result = await measuredGoto(page, route, baseURL!);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.transferBytes).toBeGreaterThan(0);
      durations_ms.push(result.duration);
      transfer_bytes.push(result.transferBytes);
    }
    results[route] = {
      durations_ms,
      transfer_bytes,
      median_duration_ms: median(durations_ms),
      median_transfer_bytes: median(transfer_bytes),
    };
  }

  await writeFile(
    output!,
    `${JSON.stringify(
      {
        metadata: {
          frontend_warmups: warmups,
          frontend_samples: samples,
          base_url: baseURL,
        },
        routes: results,
      },
      null,
      2,
    )}\n`,
  );
});
