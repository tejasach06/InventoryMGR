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

  /** Every facet lives inside the Filters drawer, which stages edits until Apply. */
  async function openFilterDrawer(page: Page) {
    await page.getByRole('button', { name: /Filters/ }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    return drawer;
  }

  test('multi-select filter (Status) appears in URL and as pill', async ({ page }) => {
    const drawer = await openFilterDrawer(page);
    // The three core enums render as a SegmentedControl: a role="group" named
    // after the facet, holding one toggle button per option.
    const option = drawer.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'running', exact: true });
    await expect(option).toBeVisible();
    await option.click();

    // Staged, not applied: the URL only changes once Apply is pressed.
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    await expect(page).not.toHaveURL(/status=running/);

    await drawer.getByRole('button', { name: /^Apply/ }).click();
    await expect(page).toHaveURL(/status=running/);

    // And it surfaces as a removable chip in the active filters row.
    await expect(page.getByRole('button', { name: 'Remove Status filter' })).toBeVisible();
  });

  test('boolean filter (Monitoring) appears in URL and as pill', async ({ page }) => {
    const drawer = await openFilterDrawer(page);
    // Monitoring is not a core enum, so it renders as a FuzzyMultiSelect whose
    // options are relabelled true/false -> Enabled/Disabled.
    await drawer.getByPlaceholder('Monitoring').click();
    await page.getByRole('button', { name: 'Enabled', exact: true }).click();

    await drawer.getByRole('button', { name: /^Apply/ }).click();
    await expect(page).toHaveURL(/monitoring_enabled=true/);

    // FilterChip renders label and value in adjacent spans, so assert on the
    // remove button's accessible name rather than the concatenated text.
    await expect(
      page.getByRole('group', { name: 'Active filters' }).getByRole('button', { name: 'Remove Monitoring filter' }),
    ).toBeVisible();
  });

  test('removing a pill clears the URL param', async ({ page }) => {
    const drawer = await openFilterDrawer(page);
    await drawer.getByPlaceholder('Monitoring').click();
    await page.getByRole('button', { name: 'Enabled', exact: true }).click();
    await drawer.getByRole('button', { name: /^Apply/ }).click();
    await expect(page).toHaveURL(/monitoring_enabled=true/);

    await page.getByRole('button', { name: 'Remove Monitoring filter' }).click();

    await expect(page).not.toHaveURL(/monitoring_enabled=true/);
    await expect(page.getByRole('button', { name: 'Remove Monitoring filter' })).toHaveCount(0);
  });
});
