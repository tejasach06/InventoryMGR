import { expect, Page, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.INVENTORYMGR_INITIAL_ADMIN_EMAIL ?? 'admin@example.local';
const ADMIN_PASSWORD = process.env.INVENTORYMGR_INITIAL_ADMIN_PASSWORD ?? 'change-me-before-use';

test.use({ screenshot: 'only-on-failure' });

async function ensureAdminSession(page: Page) {
  await page.goto('/login');
  const setup = page.getByRole('button', { name: 'Create admin account' });
  const signin = page.getByRole('button', { name: 'Sign in' });
  await expect(setup.or(signin)).toBeVisible();

  if (await setup.isVisible().catch(() => false)) {
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByLabel('Confirm password').fill(ADMIN_PASSWORD);
    await setup.click();
    await expect(page).toHaveURL(/\/inventory$/);
    return;
  }

  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  await signin.click();
  await expect(page).toHaveURL(/\/inventory$/);
}

const VIEWPORTS = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 667 },
];

async function captureState(
  page: Page,
  viewport: { name: string; width: number; height: number },
  state: string,
  action: () => Promise<void>,
) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto('/inventory');
  await page.waitForTimeout(600);
  await action();
  await page.waitForTimeout(300);
  const path = `reports/visual-${viewport.name}-${state}.png`;
  await page.screenshot({ path, fullPage: false });
}

test.describe('InventoryMGR visual report', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAdminSession(page);
  });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} default inventory`, async ({ page }) => {
      await captureState(page, viewport, 'default', async () => {});
    });

    test(`${viewport.name} presets dropdown open`, async ({ page }) => {
      await captureState(page, viewport, 'presets-open', async () => {
        const presetTrigger = page
          .getByRole('button', { name: /preset/i })
          .or(page.getByLabel('Filter presets'))
          .first();
        if ((await presetTrigger.count()) > 0) {
          await presetTrigger.click();
          await page.waitForTimeout(200);
        }
      });
    });

    test(`${viewport.name} column editor open`, async ({ page }) => {
      await captureState(page, viewport, 'column-editor-open', async () => {
        const columnTrigger = page
          .getByRole('button', { name: /column/i })
          .or(page.getByLabel('Columns'))
          .first();
        if ((await columnTrigger.count()) > 0) {
          await columnTrigger.click();
          await page.waitForTimeout(200);
        }
      });
    });

    test(`${viewport.name} filters applied`, async ({ page }) => {
      await captureState(page, viewport, 'filters-applied', async () => {
        const search = page
          .getByLabel('Search VMs')
          .or(page.getByPlaceholder('Search VMs'))
          .first();
        if ((await search.count()) > 0) {
          await search.fill('test');
          await page.waitForTimeout(250);
        }
      });
    });
  }
});
