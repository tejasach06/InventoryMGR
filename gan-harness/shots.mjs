import { createRequire } from 'node:module';
const require = createRequire('/work/frontend/');
const { chromium } = require('@playwright/test');
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = process.env.OUT || 'gan-harness/shots/baseline';
const email = process.env.INVENTORYMGR_INITIAL_ADMIN_EMAIL || 'admin@example.local';
const password = process.env.INVENTORYMGR_INITIAL_ADMIN_PASSWORD || 'change-me-before-use';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.setDefaultNavigationTimeout(90000);
page.setDefaultTimeout(30000);

async function shot(name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('shot', name);
}

// --- Login / setup screen (design surface) ---
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
const setupBtn = page.getByRole('button', { name: 'Create admin account' });
const signInBtn = page.getByRole('button', { name: 'Sign in' });
await setupBtn.or(signInBtn).waitFor({ state: 'visible', timeout: 15000 });
await shot('login');

// --- Authenticate (setup on fresh DB, else sign in) ---
if (await setupBtn.isVisible()) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await setupBtn.click();
} else {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await signInBtn.click();
}
try {
  await page.waitForURL(/\/inventory$/, { timeout: 90000 });
} catch {
  await page.waitForTimeout(1500);
  console.log('AUTH-DEBUG url=', page.url());
  const bodyText = await page.locator('body').innerText().catch(() => '');
  console.log('AUTH-DEBUG body snippet:', bodyText.slice(0, 400).replace(/\n+/g, ' | '));
  await page.screenshot({ path: `${OUT}/auth-debug.png`, fullPage: true });
  throw new Error('auth did not reach /inventory');
}

// --- Seed VMs via API only when inventory is empty (idempotent re-runs) ---
const cookies = await ctx.cookies();
const csrf = cookies.find((c) => c.name === 'inventorymgr_csrf')?.value;
async function listVms() {
  const r = await page.request.get(`${BASE}/api/vms?`);
  const j = await r.json().catch(() => ({}));
  return j.items || j.vms || (Array.isArray(j) ? j : []);
}
const seeds = [
  { name: 'pve-app-01', platform: 'proxmox', cluster: 'pve-cluster-a', datacenter: 'dc-east', status: 'running', cpu_cores: 8, memory_mb: 16384, disk_gb: [120, 500], os_name: 'Ubuntu 22.04 LTS', os_family: 'linux', ip_addresses: ['10.0.12.10', '10.0.12.11'], owner: 'platform-team', notes: 'Primary app node', backup_enabled: true, ha_enabled: true, criticality: 'high', lifecycle: 'active', tags: ['web', 'prod'], external_id: 'pve-1001', sr_id: 'SR-2048', last_verified_at: '2026-06-13' },
  { name: 'vmw-db-02', platform: 'vmware', cluster: 'vc-cluster-b', datacenter: 'dc-west', status: 'stopped', cpu_cores: 16, memory_mb: 65536, disk_gb: [200, 1000, 2000], os_name: 'Rocky Linux 9', os_family: 'linux', ip_addresses: ['10.0.30.42'], owner: 'db-team', notes: '', backup_enabled: false, ha_enabled: false, criticality: 'critical', lifecycle: 'active', tags: ['database'], external_id: 'vmw-77', sr_id: '', last_verified_at: null },
  { name: 'pve-cache-03', platform: 'proxmox', cluster: 'pve-cluster-a', datacenter: 'dc-east', status: 'suspended', cpu_cores: 4, memory_mb: 8192, disk_gb: [80], os_name: 'Debian 12', os_family: 'linux', ip_addresses: ['10.0.12.30'], owner: 'platform-team', notes: '', backup_enabled: true, ha_enabled: false, criticality: 'medium', lifecycle: 'retiring', tags: ['cache'], external_id: 'pve-1003', sr_id: '', last_verified_at: null },
];
let existing = await listVms();
if (existing.length === 0) {
  for (const body of seeds) {
    const res = await page.request.post(`${BASE}/api/vms`, { headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, data: body });
    if (!res.ok()) console.log('seed failed', body.name, res.status(), await res.text());
  }
  existing = await listVms();
}
const firstId = existing.find((v) => v.name === 'pve-app-01')?.id || existing[0]?.id || null;
console.log('vms', existing.length, 'firstId', firstId);

// --- Seed a couple dropdown options so Settings has content ---
for (const [category, value] of [['datacenter', 'dc-east'], ['datacenter', 'dc-west'], ['cpu', '8'], ['os', 'Ubuntu 22.04 LTS']]) {
  await page.request.post(`${BASE}/api/settings/options`, {
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    data: { category, value },
  }).catch(() => {});
}

// --- Light-theme screenshots ---
await page.goto(`${BASE}/inventory`, { waitUntil: 'networkidle' });
await shot('inventory');
if (firstId) { await page.goto(`${BASE}/inventory/${firstId}`, { waitUntil: 'networkidle' }); await shot('vm-detail'); }
await page.goto(`${BASE}/inventory/new`, { waitUntil: 'networkidle' });
await shot('vm-form');
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await shot('settings');
await page.goto(`${BASE}/imports/new`, { waitUntil: 'networkidle' });
await shot('import');

// --- Dark-theme samples ---
await page.addInitScript(() => window.localStorage.setItem('inventorymgr-theme', 'dark'));
await page.goto(`${BASE}/inventory`, { waitUntil: 'networkidle' });
await shot('inventory-dark');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
// logged in → may redirect; capture whatever renders for dark chrome
await shot('login-or-app-dark');

await browser.close();
console.log('DONE');
