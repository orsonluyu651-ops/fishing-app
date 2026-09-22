#!/bin/bash
set -e

# Bind git to the repo-tracked hooks directory so every clone of this
# repository runs the same verification gates (type check + full test
# suite + env-presence) as a binding commit condition.
cd "$(dirname "$0")/.."

git config core.hooksPath .githooks
chmod +x .githooks/pre-commit

echo "[BOOTSTRAP] Hooks bound to .githooks ($(git config core.hooksPath))"
echo "[BOOTSTRAP] Active gate: .githooks/pre-commit (tsc + npm test + env presence)"
