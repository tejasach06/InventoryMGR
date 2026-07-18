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
    // Every fixed-enum facet renders inline as a SegmentedControl: a role="group"
    // named after the facet, holding one toggle button per option.
    const option = page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'running', exact: true });
    await expect(option).toBeVisible();
    await option.click();

    // Applied immediately — inline facets have no separate Apply step.
    await expect(page).toHaveURL(/status=running/);
    await expect(option).toHaveAttribute('aria-pressed', 'true');

    // And it surfaces as a removable chip in the active filters row.
    await expect(page.getByRole('button', { name: 'Remove Status filter' })).toBeVisible();
  });

  test('boolean filter (Monitoring) appears in URL and as pill', async ({ page }) => {
    // Monitoring is an inline facet too; its options are relabelled true/false -> Enabled/Disabled.
    const enabled = page.getByRole('group', { name: 'Monitoring' }).getByRole('button', { name: 'Enabled', exact: true });
    await expect(enabled).toBeVisible();
    await enabled.click();

    await expect(page).toHaveURL(/monitoring_enabled=true/);
    await expect(enabled).toHaveAttribute('aria-pressed', 'true');

    // FilterChip renders label and value in adjacent spans, so assert on the
    // remove button's accessible name rather than the concatenated text.
    await expect(
      page.getByRole('group', { name: 'Active filters' }).getByRole('button', { name: 'Remove Monitoring filter' }),
    ).toBeVisible();
  });

  test('removing a pill clears the URL param', async ({ page }) => {
    await page.getByRole('group', { name: 'Monitoring' }).getByRole('button', { name: 'Enabled', exact: true }).click();
    await expect(page).toHaveURL(/monitoring_enabled=true/);

    await page.getByRole('button', { name: 'Remove Monitoring filter' }).click();

    await expect(page).not.toHaveURL(/monitoring_enabled=true/);
    await expect(page.getByRole('button', { name: 'Remove Monitoring filter' })).toHaveCount(0);
  });
});
