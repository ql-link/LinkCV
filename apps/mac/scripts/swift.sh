#!/usr/bin/env bash
# Keep the system toolchain untouched when a CLT update left a stale private interface.
set -euo pipefail
cd "$(dirname "$0")/.."
PM="$(xcode-select -p)/usr/lib/swift/pm"
MODULE="$PM/ManifestAPI/PackageDescription.swiftmodule"
ARCH="$(uname -m)"
PUBLIC="$MODULE/$ARCH-apple-macos.swiftinterface"
PRIVATE="$MODULE/$ARCH-apple-macos.private.swiftinterface"
if [ -z "${SWIFTPM_CUSTOM_LIBS_DIR:-}" ] && [ -f "$PRIVATE" ] && [ -f "$PUBLIC" ] \
    && grep -q 'swiftLanguageModes' "$PUBLIC" && ! grep -q 'swiftLanguageModes' "$PRIVATE"; then
  TASK_PM="$(mktemp -d "${TMPDIR:-/tmp/}drawoffer-swift-pm.XXXXXX")"
  trap 'rm -rf "$TASK_PM"' EXIT
  cp -R "$PM/ManifestAPI" "$TASK_PM/"
  rm "$TASK_PM/ManifestAPI/PackageDescription.swiftmodule/"*.private.swiftinterface
  export SWIFTPM_CUSTOM_LIBS_DIR="$TASK_PM"
fi
swift "$@"
