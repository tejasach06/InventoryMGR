import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.INVENTORYMGR_INITIAL_ADMIN_EMAIL ?? 'admin@example.local';
const ADMIN_PASSWORD = process.env.INVENTORYMGR_INITIAL_ADMIN_PASSWORD ?? 'change-me-before-use';

test.use({ screenshot: 'only-on-failure' });

async function ensureAdminSession(page) {
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

test.describe('InventoryMGR inventory visual report', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAdminSession(page);
    await page.goto('/inventory');
    await page.waitForTimeout(500);
  });

  test('desktop full inventory page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/inventory');
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
    await page.screenshot({ path: 'reports/inventory-desktop-full.png', fullPage: true });
  });

  test('mobile card view', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1200 });
    await page.goto('/inventory');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'reports/inventory-mobile.png', fullPage: true });
  });

  test('presets dropdown open', async ({ page }) => {
    await page.goto('/inventory');
    await page.waitForTimeout(300);
    const presetTrigger = page.getByRole('button', { name: /preset/i }).or(page.getByLabel('Filter presets')).first();
    if (await presetTrigger.count() > 0) {
      await presetTrigger.click();
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path: 'reports/inventory-presets-open.png', fullPage: false });
  });

  test('column editor dropdown open', async ({ page }) => {
    await page.goto('/inventory');
    await page.waitForTimeout(300);
    const columnTrigger = page.getByRole('button', { name: /column/i }).or(page.getByLabel('Columns')).first();
    if (await columnTrigger.count() > 0) {
      await columnTrigger.click();
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path: 'reports/inventory-column-editor-open.png', fullPage: false });
  });

  test('filter bar with active filters', async ({ page }) => {
    await page.goto('/inventory');
    await page.waitForTimeout(300);
    const search = page.getByLabel('Search VMs').or(page.getByPlaceholder('Search VMs')).first();
    if (await search.count() > 0) {
      await search.fill('test');
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path: 'reports/inventory-filter-bar-active.png', fullPage: false });
  });

  test('empty state if applicable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const emptyFiltersButton = page.getByRole('button', { name: /clear/i }).or(page.getByRole('button', { name: /reset/i }));
    if (await emptyFiltersButton.count() > 0) {
      await emptyFiltersButton.first().click();
      await page.waitForTimeout(300);
    }
    const emptyText = page.getByText(/No results|No VMs|No inventory|No items/i);
    if (await emptyText.count() > 0) {
      await emptyText.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'reports/inventory-empty-state.png', fullPage: true });
    }
  });
});
