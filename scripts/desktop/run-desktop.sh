#!/usr/bin/env bash
set -euo pipefail
cd "$(cd "$(dirname "$0")/../.." && pwd)/desktop-app"
[ -d node_modules ] || npm install
npm start
