import { APIRequestContext, expect, request, test } from '@playwright/test';

// Synthetic-only abuse matrix; runs only via tools/run-rust-e2e.sh (disposable DB, loopback).
test.describe.configure({ mode: 'serial' });

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const csrfCookie = process.env.CSRF_COOKIE_NAME ?? 'inventorymgr_e2e+csrf';
const pw = 'Abuse-Fixture-Pw-1!';
const mail = (n: string) => `abuse-${n}@example.local`;
const ZERO = '00000000-0000-0000-0000-000000000000';
let admin: APIRequestContext;
const roles: Record<string, APIRequestContext> = {};
const ids: Record<string, string> = {};

async function ctx() {
  return request.newContext({ baseURL: base });
}
async function csrf(c: APIRequestContext) {
  const s = await c.storageState();
  return s.cookies.find((k) => k.name === csrfCookie)?.value ?? '';
}
async function mut(c: APIRequestContext, method: 'post' | 'patch', url: string, data: unknown, token?: string) {
  const headers = { 'X-CSRF-Token': token ?? (await csrf(c)) };
  return method === 'post' ? c.post(url, { data, headers }) : c.patch(url, { data, headers });
}
async function login(email: string, password = pw) {
  const c = await ctx();
  expect((await c.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  return c;
}

test('1 bootstrap race: exactly one admin wins, loser is 4xx', async () => {
  // The race is only meaningful on an empty database; earlier specs in a full run already created the admin.
  const fresh = (await (await ctx()).get('/api/auth/setup').then((r) => r.json())).setup_required === true;
  const a = await ctx();
  const b = await ctx();
  const [ra, rb] = await Promise.all([
    a.post('/api/auth/setup', { data: { email: mail('admin-a'), password: pw } }),
    b.post('/api/auth/setup', { data: { email: mail('admin-b'), password: pw } }),
  ]);
  const codes = [ra.status(), rb.status()];
  expect(codes.every((s) => s < 500), `no 5xx: ${codes}`).toBe(true);
  if (fresh) {
    expect(codes.filter((s) => s < 300).length, `exactly one winner: ${codes}`).toBe(1);
    admin = await login(ra.status() < 300 ? mail('admin-a') : mail('admin-b'));
  } else {
    expect(codes.every((s) => s >= 400), `setup closed, both rejected: ${codes}`).toBe(true);
    // Act through a dedicated admin so later specs keep their shared admin's sessions and password.
    const shared = await login(
      process.env.INVENTORYMGR_INITIAL_ADMIN_EMAIL ?? 'admin@example.local',
      process.env.INVENTORYMGR_INITIAL_ADMIN_PASSWORD ?? 'change-me-before-use',
    );
    expect((await mut(shared, 'post', '/api/users', { email: mail('admin'), password: pw, role: 'admin' })).status()).toBeLessThan(300);
    admin = await login(mail('admin'));
  }
  for (const r of ['viewer', 'editor']) {
    const res = await mut(admin, 'post', '/api/users', { email: mail(r), password: pw, role: r });
    expect(res.status()).toBeLessThan(300);
    ids[r] = (await res.json()).id;
    roles[r] = await login(mail(r));
  }
});

test('2 role bypass: anon 401, viewer/editor 403, admin passes', async () => {
  for (const p of ['/api/users', '/api/settings/app', '/api/settings/ldap', '/api/backups']) {
    expect((await (await ctx()).get(p)).status(), `anon ${p}`).toBe(401);
    for (const r of ['viewer', 'editor']) {
      const res = await roles[r].get(p);
      expect(res.status(), `${r} ${p}`).toBe(403);
    }
    expect((await admin.get(p)).status(), `admin ${p}`).toBeLessThan(400);
  }
});

test('3 forged mutation: self-escalation and CSRF-less create denied', async () => {
  for (const r of ['viewer', 'editor']) {
    const res = await mut(roles[r], 'patch', `/api/users/${ids[r]}`, { role: 'admin' });
    expect(res.status()).toBe(403);
    expect((await (await roles[r].get('/api/auth/me')).json()).role).toBe(r);
  }
  for (const token of ['', 'not-the-token']) {
    const res = await mut(admin, 'post', '/api/users', { email: mail('ghost'), password: pw, role: 'viewer' }, token);
    expect(res.status()).toBe(403);
  }
  expect(await (await admin.get('/api/users')).text()).not.toContain(mail('ghost'));
});

test('4 stale sessions: reset, disable and demote cut access', async () => {
  const vid = (await (await mut(admin, 'post', '/api/users', { email: mail('victim'), password: pw, role: 'editor' })).json()).id;
  const old = await login(mail('victim'));
  expect((await mut(admin, 'patch', `/api/users/${vid}`, { password: `${pw}-new` })).status()).toBeLessThan(300);
  expect((await old.get('/api/auth/me')).status()).toBe(401);
  expect((await old.post('/api/auth/refresh')).status()).toBe(401);
  expect((await roles.viewer.get('/api/auth/me')).status()).toBe(200);

  expect((await mut(admin, 'patch', `/api/users/${vid}`, { is_active: false })).status()).toBeLessThan(300);
  expect((await old.get('/api/auth/me')).status()).toBe(401);

  // Demoted editor must lose editor-only mutation rights immediately (editor token still held).
  expect((await mut(admin, 'patch', `/api/users/${ids.editor}`, { role: 'viewer' })).status()).toBeLessThan(300);
  const res = await mut(roles.editor, 'post', `/api/imports/${ZERO}/commit`, {});
  expect(res.status()).toBe(403);
});

test('5 stored markup renders as text', async ({ page }) => {
  const payload = '<img src=x onerror="window.__inventorymgrProbe=1">';
  await page.goto('/login');
  await page.getByLabel('Email').fill((await (await admin.get('/api/auth/me')).json()).email);
  await page.getByLabel('Password').fill(pw);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'New VM' }).click();
  await page.locator('#name').fill(payload);
  await page.getByLabel('Platform').selectOption('proxmox');
  await page.getByLabel('Cluster').fill('security-fixture');
  await page.locator('#status').selectOption('running');
  await page.getByLabel('CPU cores').fill('4');
  await page.getByLabel('Memory GB').fill('8');
  await page.locator('#criticality').selectOption('high');
  await page.getByRole('button', { name: 'Save VM' }).click();
  const heading = page.getByRole('heading', { name: payload, exact: true });
  const validation = page.getByRole('alert').or(page.locator('[aria-invalid="true"]')).first();
  await expect(heading.or(validation)).toBeVisible();
  const rejected = await validation.isVisible();
  if (!rejected) {
    await expect(heading).toBeVisible();
    await expect(page.locator('img[onerror]')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, '__inventorymgrProbe'))).toBeUndefined();
  }
  await page.goto('/inventory');
  const entry = page.getByRole('link', { name: payload, exact: true });
  if (rejected) {
    await expect(entry).toHaveCount(0);
  } else {
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(heading).toBeVisible();
    await page.goto('/inventory');
  }
  await expect(page.locator('img[onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__inventorymgrProbe'))).toBeUndefined();
});

test('6 malformed and oversized imports', async () => {
  const csv = 'name,platform,cluster,status,cpu_cores,memory_mb,criticality\nbad,proxmox,c,running,not-a-number,1,low';
  const before = await (await admin.get('/api/vms')).text();
  const token = await csrf(admin);
  const small = await admin.post('/api/imports/preview', {
    multipart: { file: { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) } },
    headers: { 'X-CSRF-Token': token },
  });
  expect(small.status()).toBeLessThan(500);
  const big = await admin.post('/api/imports/preview', {
    multipart: { file: { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.alloc(6 * 1024 * 1024 + 4096, 'a') } },
    headers: { 'X-CSRF-Token': token },
  });
  expect(big.status()).toBe(413);
  expect(await (await admin.get('/api/vms')).text()).toBe(before);
});

test('7 backup traversal attempts never leak or 5xx', async () => {
  for (const name of ['..%2Foutside.sql', '%2Fetc%2Fpasswd-sentinel', '..%5Coutside.sql']) {
    const res = await admin.get(`/api/backups/${name}/download`);
    expect([400, 404, 422]).toContain(res.status());
    for (const r of ['viewer', 'editor']) expect((await roles[r].get(`/api/backups/${name}/download`)).status()).toBe(403);
  }
});

test('8 copied tokens after logout must be rejected (server-side revocation)', async () => {
  const c = await login(mail('viewer'));
  const copied = await c.storageState();
  expect((await mut(c, 'post', '/api/auth/logout', {})).status()).toBeLessThan(300);
  const replay = await request.newContext({ baseURL: base, storageState: copied });
  const sessionStatus = (await replay.get('/api/auth/me')).status();
  const refreshStatus = (await replay.post('/api/auth/refresh')).status();
  expect.soft(sessionStatus, 'old session after logout').toBe(401);
  expect.soft(refreshStatus, 'old refresh after logout').toBe(401);
});
