import { expect, Page, test } from '@playwright/test';

const adminEmail = process.env.INVENTORYMGR_INITIAL_ADMIN_EMAIL ?? 'admin@example.local';
const adminPassword = process.env.INVENTORYMGR_INITIAL_ADMIN_PASSWORD ?? 'change-me-before-use';

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  const setupButton = page.getByRole('button', { name: 'Create admin account' });
  const signInButton = page.getByRole('button', { name: 'Sign in' });
  await expect(setupButton.or(signInButton)).toBeVisible();
  if (await setupButton.isVisible()) {
    await page.getByLabel('Email').fill(adminEmail);
    await page.getByLabel('Password', { exact: true }).fill(adminPassword);
    await page.getByLabel('Confirm password').fill(adminPassword);
    await setupButton.click();
  } else {
    await page.getByLabel('Email').fill(adminEmail);
    await page.getByLabel('Password').fill(adminPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(page).toHaveURL(/\/inventory$/);
}

test.describe('Filter Menu', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('multi-select filter (Status) appears in URL and as pill', async ({ page }) => {
    // Status is a core filter — its FuzzyMultiSelect input takes its accessible name from
    // the placeholder ("Status"); the sr-only <label> isn't wired to the input's id.
    const statusInput = page.getByRole('group', { name: 'Core filters' }).getByRole('textbox', { name: 'Status' });
    await statusInput.click();

    const option = page.getByRole('button', { name: 'running', exact: true });
    await expect(option).toBeVisible();
    await option.click();

    // Applied immediately (no separate Apply step for core filters).
    await expect(page).toHaveURL(/status=running/);

    // Verify the selected value renders as a pill inside the core filter input.
    await expect(page.getByRole('group', { name: 'Core filters' }).getByText('running')).toBeVisible();
  });

  test('boolean filter (Monitoring) appears in URL and as pill', async ({ page }) => {
    // Monitoring lives in the advanced drawer behind "More".
    await page.getByRole('button', { name: 'Open advanced filters' }).click();

    await expect(page.getByRole('group', { name: 'Features' }).getByText('Monitoring', { exact: true })).toBeVisible();
    const monitoringInput = page.getByRole('textbox', { name: 'Monitoring' });
    await monitoringInput.click();

    const enabledOption = page.getByRole('button', { name: 'Enabled', exact: true });
    await expect(enabledOption).toBeVisible();
    await enabledOption.click();

    await page.getByRole('button', { name: /^Apply/ }).click();

    // Wait for URL to update
    await expect(page).toHaveURL(/monitoring_enabled=true/);

    // Verify chip is visible in the active filters row with mapped label
    await expect(page.getByRole('group', { name: 'Active filters' }).getByText('Monitoring: Enabled')).toBeVisible();
  });

  test('removing a pill clears the URL param', async ({ page }) => {
    // Apply a Monitoring filter via the advanced drawer (renders as a removable chip).
    await page.getByRole('button', { name: 'Open advanced filters' }).click();
    await page.getByRole('textbox', { name: 'Monitoring' }).click();
    await page.getByRole('button', { name: 'Enabled', exact: true }).click();
    await page.getByRole('button', { name: /^Apply/ }).click();
    await expect(page).toHaveURL(/monitoring_enabled=true/);

    // Click the chip's remove button
    await page.getByRole('button', { name: 'Remove Monitoring filter' }).click();

    // URL should no longer have the param
    await expect(page).not.toHaveURL(/monitoring_enabled=true/);

    // Chip should be gone
    await expect(page.getByRole('group', { name: 'Active filters' }).getByText('Monitoring: Enabled')).not.toBeVisible();
  });
});
