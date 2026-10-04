#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
work=$(mktemp -d "${TMPDIR:-/tmp}/linkresume-paper.XXXXXX")
trap 'rm -rf "$work"' EXIT
node apps/native/scripts/build_renderer.mjs
LINKRESUME_RENDER_CASES="$work/cases.json" node apps/native/scripts/check_renderer.mjs
swiftc -parse-as-library apps/native/scripts/check_webkit.swift -o "$work/check-webkit"
"$work/check-webkit" "$work/cases.json" "$PWD/apps/native/renderer/dist/paper.html"
