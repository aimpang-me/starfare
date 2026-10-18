#!/bin/bash
# Cloud sessions only: install what the test suites in CLAUDE.md need, so a fresh
# container can run them without setup. Local machines (Alvin's PC) are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Connector (Worker, MCP server, site): wrangler, agents, MCP SDK. npm ci, because npm install
# rewrites the lockfile's old package name and leaves the tree dirty. Skipped when already in sync.
if ! (cd connector && npm ls --depth=0 >/dev/null 2>&1); then
  (cd connector && npm ci --no-audit --no-fund --loglevel=error)
fi

# Python regression gate (day3/run_regression.py), same packages as .github/workflows/sol-regression.yml.
python3 -m pip install --quiet --disable-pip-version-check numpy scipy jplephem skyfield-data \
  || python3 -m pip install --quiet --disable-pip-version-check --break-system-packages numpy scipy jplephem skyfield-data
