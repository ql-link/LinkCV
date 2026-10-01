#!/usr/bin/env bash
# 运行 Mac 客户端单测。装了完整 Xcode 时 `swift test` 直接可用；
# 只有 Command Line Tools 时 Swift Testing 框架不在默认搜索路径里，这里显式补上。
set -euo pipefail
cd "$(dirname "$0")/.."
CLT=/Library/Developer/CommandLineTools/Library/Developer
if xcode-select -p | grep -q CommandLineTools && [ -d "$CLT/Frameworks/Testing.framework" ]; then
  exec swift test -Xswiftc -F"$CLT/Frameworks" -Xlinker -F"$CLT/Frameworks" \
    -Xlinker -rpath -Xlinker "$CLT/Frameworks" -Xlinker -rpath -Xlinker "$CLT/usr/lib"
fi
exec swift test
