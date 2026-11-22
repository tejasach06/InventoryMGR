import { expect, Page, test } from '@playwright/test';

const adminEmail = process.env.INVENTORYMGR_INITIAL_ADMIN_EMAIL ?? 'admin@example.local';
const adminPassword = process.env.INVENTORYMGR_INITIAL_ADMIN_PASSWORD ?? 'change-me-before-use';

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  const setupButton = page.getByRole('button', { name: 'Create admin account' });
  const signInButton = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(setupButton.or(signInButton)).toBeVisible();
  if (await setupButton.isVisible()) {
    await page.getByLabel('Email').fill(adminEmail);
    await page.getByLabel('Password', { exact: true }).fill(adminPassword);
    await page.getByLabel('Confirm password').fill(adminPassword);
    await setupButton.click();
  } else {
    await page.getByLabel('Email').fill(adminEmail);
    await page.getByLabel('Password').fill(adminPassword);
    await signInButton.click();
  }
  await expect(page).toHaveURL(/\/inventory$/);
}

async function createVm(page: Page, name: string) {
  await page.getByRole('link', { name: 'New VM' }).click();
  await page.locator('#name').fill(name);
  await page.getByLabel('Platform').selectOption('proxmox');
  await page.getByLabel('Cluster').fill('a11y-cluster');
  await page.locator('#status').selectOption('running');
  await page.getByLabel('CPU cores').fill('4');
  await page.getByLabel('Memory GB').fill('8');
  await page.locator('#criticality').selectOption('high');
  await page.getByRole('button', { name: 'Save VM' }).click();
  await expect(page).toHaveURL(/\/inventory\/[^/]+$/);
}

test('CPU and RAM are separate columns whose visibility persists server-side', async ({ page }) => {
  await loginAsAdmin(page);
  await createVm(page, `a11y-cols-${Date.now()}`);
  await page.goto('/inventory');
  await expect(page.getByRole('columnheader', { name: /^CPU/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^RAM/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Resources/ })).toHaveCount(0);

  await page.getByRole('button', { name: /Columns/ }).click();
  const save = page.waitForResponse((r) => r.url().includes('/user/preferences/') && r.request().method() === 'PUT');
  await page.locator('#column-cpu_cores').uncheck();
  expect((await save).status()).toBe(200);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('columnheader', { name: /^CPU/ })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: /^RAM/ })).toBeVisible();

  // restore so later specs see the default layout
  await page.getByRole('button', { name: /Columns/ }).click();
  const restore = page.waitForResponse((r) => r.url().includes('/user/preferences/') && r.request().method() === 'PUT');
  await page.locator('#column-cpu_cores').check();
  expect((await restore).status()).toBe(200);
});

test('inline edit works from the keyboard and Escape cancels', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/inventory');
  const cell = page.locator('[data-testid="cell-criticality"]').first();
  await cell.getByRole('button').focus();
  await page.keyboard.press('Enter');
  await expect(cell.locator('select')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cell.locator('select')).toHaveCount(0);
});

test('drawer traps focus, closes on Escape and returns focus', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/inventory');
  const trigger = page.getByRole('button', { name: /Columns/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
