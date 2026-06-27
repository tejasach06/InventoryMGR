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
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Password').fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/inventory$/);
}

test('admin creates a Proxmox VM, previews a CSV create/update import, commits it, and sees inventory changes', async ({ page }) => {
  const runId = Date.now();
  const proxmoxName = `e2e-pve-${runId}`;
  const vmwareName = `e2e-vmw-${runId}`;

  await setupInitialAdmin(page);
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAsAdmin(page);

  await page.getByRole('link', { name: 'New VM' }).click();
  await expect(page.getByRole('heading', { name: 'New VM' })).toBeVisible();
  await page.getByLabel('Name').fill(proxmoxName);
  await page.getByLabel('Platform').selectOption('proxmox');
  await page.getByLabel('Cluster').fill('pve-cluster-a');
  await page.locator('#status').selectOption('running');
  await page.getByLabel('CPU cores').fill('4');
  await page.getByLabel('Memory GB').fill('8');
  await page.getByLabel('Disk 1 size').fill('120');
  await page.locator('#criticality').selectOption('high');
  await page.getByRole('button', { name: 'Save VM' }).click();

  await expect(page.getByRole('heading', { name: proxmoxName })).toBeVisible();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByRole('link', { name: proxmoxName })).toBeVisible();

  await page.getByRole('link', { name: 'Import' }).click();
  const csv = [
    'name,platform,cluster,status,cpu_cores,memory_mb,disk_gb,criticality,lifecycle,external_id,owner',
    `${vmwareName},vmware,vc-cluster,running,2,4096,80,medium,active,vmw-${runId},platform-team`,
    `${proxmoxName},proxmox,pve-cluster-a,stopped,6,12288,150,critical,active,,ops-team`,
  ].join('\n');
  await page.getByLabel('CSV file', { exact: true }).setInputFiles({
    name: `inventory-${runId}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByRole('button', { name: 'Preview CSV' }).click();

  const summary = page.getByLabel('Preview summary');
  await expect(summary.locator('.summary-card').filter({ hasText: 'create' }).locator('strong')).toHaveText('1');
  await expect(summary.locator('.summary-card').filter({ hasText: 'update' }).locator('strong')).toHaveText('1');
  await expect(summary.locator('.summary-card').filter({ hasText: 'conflict' }).locator('strong')).toHaveText('0');
  await expect(summary.locator('.summary-card').filter({ hasText: 'invalid' }).locator('strong')).toHaveText('0');

  await page.getByRole('button', { name: 'Commit persisted batch' }).click();
  await expect(page.getByText('Import committed. Inventory has been updated from persisted preview rows.')).toBeVisible();

  await page.getByRole('link', { name: 'Inventory' }).click();
  await expect(page.getByRole('link', { name: vmwareName })).toBeVisible();
  await page.getByLabel('Search').fill(proxmoxName);
  await page.getByRole('button', { name: 'Apply filters' }).click();
  const proxmoxRow = page.getByRole('row').filter({ hasText: proxmoxName });
  await expect(proxmoxRow).toContainText('stopped');
  await expect(proxmoxRow).toContainText('12 GB');
  await expect(proxmoxRow).toContainText('150 GB');
});
