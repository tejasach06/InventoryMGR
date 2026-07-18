import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3001';
const SHOTS = process.env.SHOTS;
const EMAIL = process.env.LOGIN_EMAIL;
const PASSWORD = process.env.LOGIN_PASSWORD;

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

let browser;
browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

// ---- login: authenticate through the API, then reuse the cookies ----
const api = await ctx.request.post('http://127.0.0.1:8000/api/auth/login', {
  data: { email: EMAIL, password: PASSWORD },
});
check('API login succeeded', api.ok(), `status ${api.status()}`);
await page.goto(`${BASE}/inventory`, { waitUntil: 'networkidle' });
check('reached /inventory', page.url().includes('/inventory'), page.url());

const card = page.getByRole('search', { name: 'Inventory filters' });
await card.waitFor({ timeout: 15000 });

// ---- 1. card contents ----
const search = page.getByRole('searchbox', { name: 'Search VMs' });
check('card: search box visible', await search.isVisible());
check('card: Filters trigger visible', await page.getByRole('button', { name: /^Filters/ }).isVisible());
check('card: Columns trigger visible', await page.getByRole('button', { name: /^Columns/ }).isVisible());

// ---- 2. no filter controls outside the drawer ----
check('card: no Status pills inline', (await card.getByRole('group', { name: 'Status' }).count()) === 0);
check('card: no Platform pills inline', (await card.getByRole('group', { name: 'Platform' }).count()) === 0);
check('card: no Presets button', (await card.getByRole('button', { name: /Presets/ }).count()) === 0);
await page.screenshot({ path: `${SHOTS}/01-card-light-1440.png` });

// ---- 3. live search ----
const rowsBefore = await page.locator('table tbody tr').count();
await search.fill('zzz-no-such-vm');
await page.waitForTimeout(1200);
const rowsAfterSearch = await page.locator('table tbody tr').count();
check('search filters the table live', rowsAfterSearch < rowsBefore || rowsAfterSearch === 0,
  `${rowsBefore} -> ${rowsAfterSearch} rows`);
check('search does not open a drawer', (await page.getByRole('dialog').count()) === 0);
await search.fill('');
await page.waitForTimeout(1200);

// ---- 4. filter drawer opens with all groups ----
await page.getByRole('button', { name: /^Filters/ }).click();
const dialog = page.getByRole('dialog');
await dialog.waitFor({ timeout: 5000 });
for (const g of ['Status', 'Platform', 'Criticality', 'Filter presets']) {
  check(`drawer: contains "${g}" group`, (await dialog.getByRole('group', { name: g }).count()) > 0);
}
for (const legend of ['Core', 'Infrastructure', 'Lifecycle & State', 'Ownership & Environment', 'Features']) {
  check(`drawer: legend "${legend}"`, (await dialog.getByText(legend, { exact: true }).count()) > 0);
}
await page.screenshot({ path: `${SHOTS}/02-filter-drawer-light.png` });

// ---- 5. staged apply ----
const rowsPre = await page.locator('table tbody tr').count();
await dialog.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'running', exact: true }).click();
await page.waitForTimeout(800);
check('staged: table unchanged before Apply',
  (await page.locator('table tbody tr').count()) === rowsPre, `${rowsPre} rows`);
check('staged: footer shows Apply (1)', (await dialog.getByRole('button', { name: 'Apply (1)' }).count()) > 0);

// ---- 6. cancel discards ----
await dialog.getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(400);
check('cancel: drawer closed', (await page.getByRole('dialog').count()) === 0);
check('cancel: no chips added', (await card.getByRole('group', { name: 'Active filters' }).count()) === 0);
await page.getByRole('button', { name: /^Filters/ }).click();
await dialog.waitFor();
check('cancel: reopen shows Apply (0)', (await dialog.getByRole('button', { name: 'Apply (0)' }).count()) > 0);

// ---- 7. apply produces chips ----
await dialog.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'running', exact: true }).click();
await dialog.getByRole('button', { name: /^Apply/ }).click();
await page.waitForTimeout(1500);
check('apply: drawer closed', (await page.getByRole('dialog').count()) === 0);
check('apply: chip row rendered', (await card.getByRole('group', { name: 'Active filters' }).count()) > 0);
check('apply: Filters trigger badged', /1/.test(await page.getByRole('button', { name: /^Filters/ }).innerText()));
await page.screenshot({ path: `${SHOTS}/03-chips-light.png` });

// ---- 8. clear all preserves search ----
await search.fill('web');
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Clear all' }).click();
await page.waitForTimeout(1200);
check('clear all: chips removed', (await card.getByRole('group', { name: 'Active filters' }).count()) === 0);
check('clear all: search preserved', (await search.inputValue()) === 'web', `value="${await search.inputValue()}"`);
await search.fill('');
await page.waitForTimeout(1000);

// ---- 9. column drawer ----
await page.getByRole('button', { name: /^Columns/ }).click();
await dialog.waitFor();
check('columns: drawer opened', (await dialog.getByText(/columns shown/i).count()) > 0);
const colsBefore = await page.locator('table thead th').count();
const firstUnchecked = dialog.locator('input[type=checkbox]:not(:checked)').first();
const hadUnchecked = (await firstUnchecked.count()) > 0;
if (hadUnchecked) {
  await firstUnchecked.click();
  await page.waitForTimeout(900);
  check('columns: toggle applies immediately (no Apply step)',
    (await page.locator('table thead th').count()) > colsBefore,
    `${colsBefore} -> ${await page.locator('table thead th').count()} headers`);
  await dialog.locator('input[type=checkbox]:checked').last().click();
  await page.waitForTimeout(600);
}
await page.screenshot({ path: `${SHOTS}/04-column-drawer-light.png` });
await dialog.getByRole('button', { name: 'Reset to default' }).click();
await page.waitForTimeout(800);
check('columns: Done closes the drawer',
  await (async () => { await dialog.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(500); return (await page.getByRole('dialog').count()) === 0; })());

// ---- 10. drawer exclusivity (modal backdrop blocks the other trigger) ----
await page.getByRole('button', { name: /^Filters/ }).click();
await dialog.waitFor();
const blocked = await page.getByRole('button', { name: /^Columns/ })
  .click({ trial: true, timeout: 1500 }).then(() => false).catch(() => true);
check('open drawer blocks the other trigger (modal backdrop)', blocked);
await dialog.getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(500);
check('closing restores access to Columns trigger',
  await page.getByRole('button', { name: /^Columns/ })
    .click({ trial: true, timeout: 1500 }).then(() => true).catch(() => false));

// ---- 11. breakpoints: horizontal overflow ----
for (const [w, h] of [[375, 800], [768, 900], [1024, 900], [1440, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`no horizontal overflow @${w}px`, overflow <= 0, `overflow ${overflow}px`);
  await page.screenshot({ path: `${SHOTS}/05-card-${w}.png` });
}

// ---- 12. drawer usable at 375 ----
await page.setViewportSize({ width: 375, height: 800 });
await page.getByRole('button', { name: /^Filters/ }).click();
await dialog.waitFor();
const box = await dialog.boundingBox();
check('drawer fits viewport @375px', box && box.width <= 375 + 1, `drawer width ${box?.width}`);
await page.screenshot({ path: `${SHOTS}/06-drawer-375.png` });

// ---- 13. dark mode ----
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
  document.documentElement.classList.add('dark');
});
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/07-drawer-dark.png` });
await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/08-card-dark.png` });

const realErrors = consoleErrors.filter((e) => !/favicon|404|Failed to load resource/i.test(e));
check('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

console.log('\n==== SUMMARY ====');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILURES:');
  failed.forEach((f) => console.log(`  - ${f.name} ${f.detail}`));
}
await browser.close();
process.exit(failed.length ? 1 : 0);

