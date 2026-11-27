#!/usr/bin/env bash
# Idempotent builds needed before the dev server and the tests: the generated config types. No containers.
# Usage: npm run dev-setup
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d config/type/.type ] || npm run build-types
