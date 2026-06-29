import { createRequire } from 'node:module';
const require = createRequire('/work/frontend/');
const { chromium } = require('@playwright/test');
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = process.env.OUT || '/work/gan-harness/shots/scale';
const email = process.env.INVENTORYMGR_INITIAL_ADMIN_EMAIL || 'admin@example.local';
const password = process.env.INVENTORYMGR_INITIAL_ADMIN_PASSWORD || 'change-me-before-use';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.setDefaultNavigationTimeout(90000);
page.setDefaultTimeout(30000);

// --- Auth: setup-or-signin ---
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
const setupBtn = page.getByRole('button', { name: 'Create admin account' });
const signInBtn = page.getByRole('button', { name: 'Sign in' });
await setupBtn.or(signInBtn).waitFor({ state: 'visible', timeout: 15000 });
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
await page.waitForURL(/\/inventory$/, { timeout: 90000 });
console.log('logged in');

async function shot(name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log('shot', name);
}

// --- Fluid width across viewports (inventory = fills) ---
for (const w of [1366, 1920, 2560]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(`${BASE}/inventory`, { waitUntil: 'networkidle' });
  await shot(`inventory-${w}`);
}

// --- Mobile ---
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/inventory`, { waitUntil: 'networkidle' });
await shot('inventory-390');

// --- Wide: form stays constrained (max-w-3xl), settings cog, collapsed toggle ---
await page.setViewportSize({ width: 1920, height: 1080 });
await page.goto(`${BASE}/inventory/new`, { waitUntil: 'networkidle' });
await shot('vm-form-1920');
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await shot('settings-1920');

await page.goto(`${BASE}/inventory`, { waitUntil: 'networkidle' });
await shot('inventory-1920-expanded');
const collapse = page.getByRole('button', { name: 'Collapse sidebar' });
if (await collapse.isVisible()) { await collapse.click(); await shot('inventory-1920-collapsed'); }

await browser.close();
console.log('DONE');
