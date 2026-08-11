# Graphify Index Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stale pre-merge Graphify index only after proving the lower node count is explained by tracked-file removals rather than extraction loss.

**Architecture:** Build a fresh isolated code-only graph, compare its source coverage with Git and the existing graph, and authorize `graphify update . --force` only when every tracked application source file remains represented or is documented as unsupported. Validate the replacement through representative architecture queries before closeout.

**Tech Stack:** Graphify CLI, Git, Python 3.12, JSON, Devbox.

## Global Constraints

- Do not force-overwrite `graphify-out/graph.json` before the isolated comparison passes.
- Do not modify application, test, deployment, or product documentation files.
- The node-count decrease alone is not proof of corruption; classify removed nodes by whether their source file is still tracked.
- Stop the force update if any tracked `backend/app/**` or `frontend/src/**` source file represented in the old graph disappears from the isolated graph without an extractor limitation recorded in the evidence.
- Keep backups and comparison artifacts outside the repository under `/tmp/inventorymgr-graphify-recovery/`.
- Run project commands from `/home/tejas/project/InventoryMGR`; use Devbox for Python comparison scripts.
- Commit no generated Graphify output because `graphify-out/` is ignored; commit only the recovery evidence README under ignored `docs/` with `git add -f`.

---

### Task 1: Build and compare an isolated replacement graph

**Files:**
- Create: `docs/superpowers/refactor/graphify-recovery/README.md`
- Local evidence only: `/tmp/inventorymgr-graphify-recovery/`

**Interfaces:**
- Consumes: `graphify-out/graph.json`, current Git tracked-file list, current source tree.
- Produces: an evidence decision `SAFE_TO_REPLACE` or `UNSAFE_TO_REPLACE`.

- [ ] **Step 1: Capture existing state and backup the index**

Run:

```bash
cd /home/tejas/project/InventoryMGR
rm -rf /tmp/inventorymgr-graphify-recovery
mkdir -p /tmp/inventorymgr-graphify-recovery
cp -a graphify-out /tmp/inventorymgr-graphify-recovery/original-graphify-out
git rev-parse HEAD > /tmp/inventorymgr-graphify-recovery/source-commit.txt
git ls-files > /tmp/inventorymgr-graphify-recovery/tracked-files.txt
python3 - <<'PY'
import json
from pathlib import Path
p = Path('graphify-out/graph.json')
data = json.loads(p.read_text())
print(len(data.get('nodes', [])))
PY
```

Expected: backup exists, source commit is recorded, and the current graph reports its node count.

- [ ] **Step 2: Build a fresh isolated code-only graph**

Run:

```bash
graphify extract . --out /tmp/inventorymgr-graphify-recovery/fresh --code-only --no-cluster
```

Expected: `/tmp/inventorymgr-graphify-recovery/fresh/graphify-out/graph.json` exists. If Graphify writes the graph directly under the output directory, record that actual path in the recovery README and use it in later commands.

- [ ] **Step 3: Compare source coverage and classify removed sources**

Run this script after setting `fresh_graph` to the path produced in Step 2:

```bash
devbox run -- python3 - <<'PY'
import json
import subprocess
from pathlib import Path

old_graph = Path('graphify-out/graph.json')
fresh_candidates = [
    Path('/tmp/inventorymgr-graphify-recovery/fresh/graphify-out/graph.json'),
    Path('/tmp/inventorymgr-graphify-recovery/fresh/graph.json'),
]
fresh_graph = next((p for p in fresh_candidates if p.exists()), None)
assert fresh_graph is not None, 'fresh graph.json not found'
tracked = set(subprocess.check_output(['git', 'ls-files'], text=True).splitlines())

def sources(path: Path) -> set[str]:
    data = json.loads(path.read_text())
    result = set()
    for node in data.get('nodes', []):
        source = node.get('source_file') or node.get('source') or node.get('src')
        if source:
            result.add(source.removeprefix('./'))
    return result

old_sources = sources(old_graph)
fresh_sources = sources(fresh_graph)
removed = sorted(old_sources - fresh_sources)
removed_tracked = sorted(set(removed) & tracked)
missing_app = [p for p in removed_tracked if p.startswith(('backend/app/', 'frontend/src/'))]
report = Path('/tmp/inventorymgr-graphify-recovery/comparison.txt')
report.write_text(
    f'old_sources={len(old_sources)}\n'
    f'fresh_sources={len(fresh_sources)}\n'
    f'removed_sources={len(removed)}\n'
    f'removed_tracked_sources={len(removed_tracked)}\n'
    f'missing_tracked_app_sources={len(missing_app)}\n'
    + '\n'.join(missing_app)
    + '\n'
)
print(report.read_text())
if missing_app:
    raise SystemExit('UNSAFE_TO_REPLACE: fresh graph lost tracked app sources')
print('SAFE_TO_REPLACE')
PY
```

Expected: prints `SAFE_TO_REPLACE`. Any missing tracked application source makes this task fail closed.

- [ ] **Step 4: Record the evidence decision**

Create `docs/superpowers/refactor/graphify-recovery/README.md` with:

```markdown
# Graphify Index Recovery

- Source commit: value from `/tmp/inventorymgr-graphify-recovery/source-commit.txt`
- Existing graph node count: value printed in Step 1
- Fresh graph node count: value from the fresh graph
- Removed source count: value from `comparison.txt`
- Removed tracked source count: value from `comparison.txt`
- Missing tracked application source count: `0`
- Decision: `SAFE_TO_REPLACE`

The pre-merge index contained nodes for files no longer tracked after the reviewed branch merge. An isolated extraction retained all tracked application source coverage, so a forced replacement is safe.
```

Use the exact measured values; do not commit instructional text or unevaluated labels.

- [ ] **Step 5: Commit recovery evidence**

Run:

```bash
git add -f docs/superpowers/refactor/graphify-recovery/README.md
git commit -m "docs: validate graphify index recovery"
```

Expected: documentation-only commit succeeds.

---

### Task 2: Replace and validate the stale index

**Files:**
- Modify ignored/generated files: `graphify-out/*`
- Modify: `docs/superpowers/refactor/graphify-recovery/README.md`

**Interfaces:**
- Consumes: `SAFE_TO_REPLACE` evidence from Task 1.
- Produces: current Graphify index and representative successful queries.

- [ ] **Step 1: Enforce the evidence gate**

Run:

```bash
grep -q 'Decision: `SAFE_TO_REPLACE`' docs/superpowers/refactor/graphify-recovery/README.md
```

Expected: status 0. Do not continue otherwise.

- [ ] **Step 2: Replace the stale index**

Run:

```bash
graphify update . --force
```

Expected: update succeeds without the lower-node-count refusal.

- [ ] **Step 3: Validate representative architecture queries**

Run:

```bash
graphify query "How do VM routes call VM services and preserve audit and health behavior?" > /tmp/inventorymgr-graphify-recovery/query-backend.txt
graphify query "How does InventoryPage connect URL filters to vmsApi and table components?" > /tmp/inventorymgr-graphify-recovery/query-frontend.txt
graphify query "Where are CSV import parsing preview and commit responsibilities?" > /tmp/inventorymgr-graphify-recovery/query-csv.txt
test -s /tmp/inventorymgr-graphify-recovery/query-backend.txt
test -s /tmp/inventorymgr-graphify-recovery/query-frontend.txt
test -s /tmp/inventorymgr-graphify-recovery/query-csv.txt
```

Expected: all query files are non-empty and cite current source paths.

- [ ] **Step 4: Record successful replacement**

Append exact update status, replacement node count, and the three query evidence paths to `docs/superpowers/refactor/graphify-recovery/README.md`, then run:

```bash
git add -f docs/superpowers/refactor/graphify-recovery/README.md
git commit -m "docs: record graphify index replacement"
```

Expected: documentation-only commit succeeds; `graphify update .` now runs without refusal.
