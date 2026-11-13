import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const converted = spawnSync(process.execPath, [
  fileURLToPath(new URL("tools/compose-to-json.mjs", root)),
  fileURLToPath(new URL("docker-compose.yml", root)),
], { encoding: "utf8" });
assert.equal(converted.status, 0, converted.stderr);
const original = JSON.parse(converted.stdout);
assert.equal(original.services.db.environment.POSTGRES_PASSWORD, "${POSTGRES_PASSWORD:-password}");
const worker = readFileSync(new URL("tools/verify-deployment.sh", root), "utf8");
// Exercise the worker's real filter without sourcing its deployment entry point.
const filter = worker.match(/jq --arg run[\s\S]*?--argjson ports[^\n]* '\r?\n([\s\S]*?)\r?\n    ' "\$WORK\/docker-compose\.json"/);
assert.ok(filter, "Worker jq transform not found");

const run = "self-check";
const password = 'test-password-"\\';
const jwt = 'test-jwt-"\\';
const work = "/tmp/compose self-check";
const dbTag = "localhost/test-postgres:self-check";
const backendTag = "localhost/test-backend:self-check";
const frontendTag = "localhost/test-frontend:self-check";
const ports = [21001, 21002, 21003];
const labels = { "inventorymgr.verification.run": run };

for (const stale of [false, true]) {
  const input = structuredClone(original);
  if (stale) {
    for (const service of Object.values(input.services)) {
      service.labels = { stale: "remove" };
      service.develop = { watch: [] };
    }
    input.networks = { stale: {} };
    input.volumes.pgdata = { name: "stale" };
  }
  const expected = structuredClone(input);
  for (const [index, [name, port]] of [["db", 5432], ["backend", 8000], ["frontend", 3000]].entries()) {
    const service = expected.services[name];
    service.ports = [`127.0.0.1:${ports[index]}:${port}`];
    service.labels = labels;
    delete service.develop;
    delete service.build;
    service.pull_policy = "never";
  }
  const { db, backend, frontend } = expected.services;
  db.image = dbTag;
  db.environment = { POSTGRES_USER: "inventorymgr", POSTGRES_DB: "inventorymgr", POSTGRES_PASSWORD: password };
  db.healthcheck.test = ["CMD-SHELL", "pg_isready -U inventorymgr"];
  backend.image = backendTag;
  backend.userns_mode = "keep-id:uid=1000,gid=1000";
  backend.environment = {
    APP_ENV: "development", DATABASE_URL: `postgresql://inventorymgr:${password}@db:5432/inventorymgr`,
    JWT_SECRET: jwt, BACKUP_DIR: "/var/lib/inventorymgr/backups",
    SESSION_COOKIE_NAME: `imgr_${run}`, CSRF_COOKIE_NAME: `csrf_${run}`,
  };
  backend.volumes = [`${work}/backups:/var/lib/inventorymgr/backups:z`];
  frontend.image = frontendTag;
  frontend.environment = { INVENTORYMGR_API_URL: "http://backend:8000", CSRF_COOKIE_NAME: `csrf_${run}` };
  expected.volumes.pgdata = { labels };
  expected.networks = { default: { labels } };

  const transformed = spawnSync("jq", [
    "--arg", "run", run, "--arg", "password", password, "--arg", "jwt", jwt,
    "--arg", "work", work, "--arg", "db_tag", dbTag, "--arg", "backend_tag", backendTag, "--arg", "frontend_tag", frontendTag,
    "--argjson", "ports", JSON.stringify(ports), filter[1],
  ], { input: JSON.stringify(input), encoding: "utf8" });
  assert.ifError(transformed.error);
  assert.equal(transformed.status, 0, transformed.stderr);
  assert.deepEqual(JSON.parse(transformed.stdout), expected);
}
console.log("Compose conversion and worker jq mutations passed (2 fixtures)");
