#!/usr/bin/env bash
#!/usr/bin/env bash
# tools/test-omp-refactor.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- fixture: a throwaway git repo shaped like backend/, with a fake omp ---
mkdir -p "$WORK/repo/backend/app/core" "$WORK/repo/backend/tests" "$WORK/bin"
cd "$WORK/repo"
git init -q
git config user.email "test@test"
git config user.name "test"
echo "def f(): return 1" > backend/app/core/__init__.py
echo "backend/*.log" > .gitignore
echo "" > backend/tests/conftest.py
git add -A
git commit -qm "init"

cat > "$WORK/bin/omp" <<'EOF'
#!/usr/bin/env bash
# fake omp: pass A/B always "succeed" (just exits 0), real behavior is
# verified by the orchestration script's own pytest re-check, not by omp.
exit 0
EOF
chmod +x "$WORK/bin/omp"

cat > "$WORK/repo/backend/pyproject.toml" <<'EOF'
[tool.pytest.ini_options]
testpaths = ["tests"]
EOF

# fake `uv` that runs plain pytest via the system python, so the test doesn't
cat > "$WORK/bin/pytest" <<'EOF'
#!/usr/bin/env bash
pwd >&2
ls -R >&2
if grep -q "assert False" tests/test_*.py; then
  exit 1
fi
exit 0
EOF
chmod +x "$WORK/bin/pytest"
mkdir -p "$WORK/bin"
cat > "$WORK/bin/uv" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "run" ]; then shift; exec "$@"; fi
EOF
chmod +x "$WORK/bin/uv"

export PATH="$WORK/bin:$PATH"

# --- case 1: green pytest -> script exits 0 and commits ---
cp "$REPO_ROOT/tools/omp-refactor.sh" "$WORK/repo/tools-omp-refactor.sh"
chmod +x "$WORK/repo/tools-omp-refactor.sh"
cd "$WORK/repo"
git add -A
if ./tools-omp-refactor.sh core; then
  echo "PASS: green case exits 0"
else
  echo "FAIL: green case should exit 0"
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "FAIL: green case should leave a clean tree (committed)"
  git status --porcelain
  exit 1
fi
echo "PASS: green case commits cleanly"

# --- case 2: red pytest -> script exits 1, tree stays dirty, no commit ---
cat > backend/tests/test_core.py <<'EOF'
def test_intentional_failure():
    assert False
EOF
BEFORE_HEAD="$(git rev-parse HEAD)"
if ./tools-omp-refactor.sh core; then
  echo "FAIL: red case should exit non-zero"
  exit 1
else
  echo "PASS: red case exits non-zero"
fi
AFTER_HEAD="$(git rev-parse HEAD)"
if [ "$BEFORE_HEAD" != "$AFTER_HEAD" ]; then
  echo "FAIL: red case must not commit"
  exit 1
fi
echo "PASS: red case does not commit"

echo "ALL PASS"
