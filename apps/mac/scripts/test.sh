#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
CLT=/Library/Developer/CommandLineTools/Library/Developer
if xcode-select -p | grep -q CommandLineTools && [ -d "$CLT/Frameworks/Testing.framework" ]; then
  exec bash scripts/swift.sh test -Xswiftc -F"$CLT/Frameworks" -Xlinker -F"$CLT/Frameworks" \
    -Xlinker -rpath -Xlinker "$CLT/Frameworks" -Xlinker -rpath -Xlinker "$CLT/usr/lib"
fi
exec bash scripts/swift.sh test
