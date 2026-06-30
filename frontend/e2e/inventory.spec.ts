import { expect, Page, test } from '@playwright/test';

const adminEmail = process.env.INVENTORYMGR_INITIAL_ADMIN_EMAIL ?? 'admin@example.local';
const adminPassword = process.env.INVENTORYMGR_INITIAL_ADMIN_PASSWORD ?? 'change-me-before-use';

async function setupInitialAdmin(page: Page) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Create admin account' })).toBeVisible();
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByLabel('Confirm password').fill(adminPassword);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page).toHaveURL(/\/inventory$/);
}

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  const setupButton = page.getByRole('button', { name: 'Create admin account' });
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

test('admin creates a Proxmox VM, previews a CSV create/update import, commits it, and sees inventory changes', async ({ page }) => {
  const runId = Date.now();
  const proxmoxName = `e2e-pve-${runId}`;
  const vmwareName = `e2e-vmw-${runId}`;

  await loginAsAdmin(page);

  await page.getByRole('link', { name: 'New VM' }).click();
  await expect(page.getByRole('heading', { name: 'New VM' })).toBeVisible();
  await page.getByLabel('Hostname').fill(proxmoxName);
  await page.getByLabel('Platform').selectOption('proxmox');
  await page.getByLabel('Cluster').fill('pve-cluster-a');
  await page.locator('#status').selectOption('running');
  await page.getByLabel('vCPU').fill('4');
  await page.getByLabel('Memory (GB)').fill('8');
  await page.locator('#criticality').selectOption('high');
  await page.getByRole('button', { name: 'Save VM' }).click();

  await expect(page.getByRole('heading', { name: proxmoxName })).toBeVisible();
  await page.goto('/inventory');
  await expect(page.getByRole('link', { name: proxmoxName })).toBeVisible();
  await page.getByRole('link', { name: 'Import' }).click();
  const csv = [
    'name,platform,cluster,status,cpu_cores,memory_mb,criticality,lifecycle,external_id,owner',
    `${vmwareName},vmware,vc-cluster,running,2,4096,medium,active,vmw-${runId},platform-team`,
    `${proxmoxName},proxmox,pve-cluster-a,powered_off,6,12288,critical,active,,ops-team`,
  ].join('\n');
  await page.getByLabel('CSV file', { exact: true }).setInputFiles({
    name: `inventory-${runId}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByRole('button', { name: 'Preview CSV' }).click();
  await page.waitForTimeout(3000);
  // Check for error alert
  const errorAlert = page.locator('[role="alert"]').first();
  if (await errorAlert.isVisible({ timeout: 1000 })) {
    console.log('Error alert:', await errorAlert.textContent());
  }
  await page.screenshot({ path: 'debug-after-preview.png', fullPage: true });
  console.log('Page content:', await page.content());
  const summary = page.locator('.summary-card');
  await expect(summary.first()).toBeVisible();
  await expect(summary.filter({ hasText: 'create' }).locator('strong')).toHaveText('1');
  await expect(summary.filter({ hasText: 'update' }).locator('strong')).toHaveText('1');
  await expect(summary.filter({ hasText: 'conflict' }).locator('strong')).toHaveText('0');
  await expect(summary.filter({ hasText: 'invalid' }).locator('strong')).toHaveText('0');

  await page.getByRole('button', { name: 'Commit persisted batch' }).click();
  await expect(page.getByText('Import committed. Inventory has been updated from persisted preview rows.')).toBeVisible();

  await page.getByRole('link', { name: 'Inventory' }).click();
  await expect(page.getByRole('link', { name: vmwareName })).toBeVisible();
  await page.getByLabel('Search').fill(proxmoxName);
  const proxmoxRow = page.getByRole('row').filter({ hasText: proxmoxName });
  await expect(proxmoxRow).toContainText('powered_off');
  await expect(proxmoxRow).toContainText('12 GB');
});
