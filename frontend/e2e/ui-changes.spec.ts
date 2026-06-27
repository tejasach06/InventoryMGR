import { expect, Page, test } from '@playwright/test';

const adminEmail = process.env.INVENTORYMGR_INITIAL_ADMIN_EMAIL ?? 'admin@example.local';
const adminPassword = process.env.INVENTORYMGR_INITIAL_ADMIN_PASSWORD ?? 'change-me-before-use';

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  const setupButton = page.getByRole('button', { name: 'Create admin account' });
  const signInButton = page.getByRole('button', { name: 'Sign in' });
  // Setup-status query resolves to either the setup form or the login form.
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

async function openNewVmForm(page: Page) {
  await page.getByRole('link', { name: 'New VM' }).click();
  await expect(page.getByRole('heading', { name: 'New VM' })).toBeVisible();
}

test('sidebar collapses to icons and expands again', async ({ page }) => {
  await loginAsAdmin(page);
  const sidebar = page.getByRole('navigation', { name: 'Primary' });
  await expect(sidebar.getByText('Inventory')).toBeVisible();

  const collapseButton = page.getByRole('button', { name: 'Collapse sidebar' });
  await expect(collapseButton).toBeVisible();
  await collapseButton.click();

  // Collapsed: labels hidden, expand control appears, icon link still present.
  const expandButton = page.getByRole('button', { name: 'Expand sidebar' });
  await expect(expandButton).toBeVisible();
  await expect(sidebar.getByText('Inventory')).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Inventory' })).toBeVisible();

  await expandButton.click();
  await expect(sidebar.getByText('Inventory')).toBeVisible();
});

test('New VM form uses VM-ID label, Location section, Owner in Identity, no Lifecycle', async ({ page }) => {
  await loginAsAdmin(page);
  await openNewVmForm(page);

  await expect(page.getByLabel('VM-ID')).toBeVisible();
  await expect(page.getByLabel('External ID')).toHaveCount(0);

  await expect(page.getByRole('heading', { name: /Location/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Placement/ })).toHaveCount(0);

  await expect(page.locator('#lifecycle')).toHaveCount(0);

  // Owner lives in the Identity section (open by default), visible without toggling.
  await expect(page.getByLabel('Owner')).toBeVisible();
});

test('Memory field is expressed in GB', async ({ page }) => {
  await loginAsAdmin(page);
  await openNewVmForm(page);

  await expect(page.getByLabel('Memory GB')).toBeVisible();
  await expect(page.getByLabel('Memory MB')).toHaveCount(0);
});

test('disk "+" button spawns and removes disk boxes', async ({ page }) => {
  await loginAsAdmin(page);
  await openNewVmForm(page);

  await expect(page.getByLabel('Disk 1 size')).toBeVisible();
  await expect(page.getByLabel('Disk 2 size')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add another disk' }).click();
  await expect(page.getByLabel('Disk 2 size')).toBeVisible();

  await page.getByRole('button', { name: 'Add another disk' }).click();
  await expect(page.getByLabel('Disk 3 size')).toBeVisible();

  await page.getByRole('button', { name: 'Remove disk 2' }).click();
  await expect(page.getByLabel('Disk 3 size')).toHaveCount(0);
  await expect(page.getByLabel('Disk 2 size')).toBeVisible();
});

test('owner suggestion applies on a single click', async ({ page }) => {
  // Seed an owner by creating a VM, then start a new VM and pick the owner suggestion.
  const ownerName = `owner-${Date.now()}`;
  await loginAsAdmin(page);

  await openNewVmForm(page);
  await page.getByLabel('Name').fill(`seed-${Date.now()}`);
  await page.getByLabel('Platform').selectOption('proxmox');
  await page.getByLabel('Cluster').fill('pve-cluster-a');
  await page.locator('#status').selectOption('running');
  await page.getByLabel('CPU cores').fill('2');
  await page.getByLabel('Memory GB').fill('4');
  await page.getByLabel('Disk 1 size').fill('40');
  await page.getByLabel('Owner').fill(ownerName);
  await page.locator('#criticality').selectOption('medium');
  await page.getByRole('button', { name: 'Save VM' }).click();
  await expect(page).toHaveURL(/\/inventory\/[0-9a-f-]+$/);

  await page.getByRole('link', { name: 'Inventory' }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await openNewVmForm(page);
  // Type a prefix so the existing owner appears as a suggestion.
  await page.getByLabel('Owner').fill(ownerName.slice(0, ownerName.length - 2));
  const suggestion = page.getByRole('button', { name: ownerName });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(page.getByLabel('Owner')).toHaveValue(ownerName);
});

test('Import page is titled "Import" and offers a CSV template download', async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole('link', { name: 'Import' }).click();
  await expect(page.getByRole('heading', { name: 'Import' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download template' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('vm-import-template.csv');
});

test('Users management lives in the Settings page, not the sidebar', async ({ page }) => {
  await loginAsAdmin(page);

  // No Users link in the sidebar anymore.
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Users' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  const usersTab = page.getByRole('tab', { name: 'Users' });
  await expect(usersTab).toBeVisible();
  await usersTab.click();
  await expect(page.getByRole('button', { name: 'New user' })).toBeVisible();
});

test('IP address "+" button spawns and removes IP address boxes', async ({ page }) => {
  await loginAsAdmin(page);
  await openNewVmForm(page);

  await expect(page.getByLabel('IP address 1', { exact: true })).toBeVisible();
  await expect(page.getByLabel('IP address 2', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Add IP address' }).click();
  await expect(page.getByLabel('IP address 2', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add IP address' }).click();
  await expect(page.getByLabel('IP address 3', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Remove IP address 2' }).click();
  await expect(page.getByLabel('IP address 3', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('IP address 2', { exact: true })).toBeVisible();
});

test('Datacenter ComboInput shows fuzzy suggestions and applies on click', async ({ page }) => {
  await loginAsAdmin(page);

  // Seed a datacenter option via Settings so the ComboInput has something to suggest.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Datacenter' }).click();
  const dcValue = `dc-fuzzy-${Date.now()}`;
  await page.getByLabel('Add Datacenter option').fill(dcValue);
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(dcValue)).toBeVisible();

  await page.getByRole('link', { name: 'Inventory' }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await openNewVmForm(page);
  // Location IS in DEFAULT_OPEN so no expansion needed — Datacenter input is immediately visible.
  await page.getByLabel('Datacenter').fill('fuzzy');
  const suggestion = page.getByRole('button', { name: dcValue });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(page.getByLabel('Datacenter')).toHaveValue(dcValue);
});

test('disk unit selector stores a TB value as GB', async ({ page }) => {
  await loginAsAdmin(page);
  await openNewVmForm(page);

  await expect(page.getByLabel('Disk 1 unit')).toBeVisible();
  await page.getByLabel('Disk 1 unit').selectOption('TB');
  await page.getByLabel('Disk 1 size').fill('2');

  const name = `e2e-disk-${Date.now()}`;
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Cluster').fill('pve-cluster-a');
  await page.getByLabel('CPU cores').fill('2');
  await page.getByLabel('Memory GB').fill('4');
  await page.locator('#criticality').selectOption('medium');
  await page.getByRole('button', { name: 'Save VM' }).click();

  await expect(page).toHaveURL(/\/inventory\/[0-9a-f-]+$/);
  await expect(page.getByText('2 TB')).toBeVisible();
});
