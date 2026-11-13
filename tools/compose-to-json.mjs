// Controller-side: Aspire has no Node, so convert docker-compose.yml to JSON (valid Compose) for jq on the worker.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { parse } = createRequire(path.join(repoRoot, "frontend", "package.json"))("yaml");
process.stdout.write(JSON.stringify(parse(readFileSync(process.argv[2], "utf8")), null, 1) + "\n");
