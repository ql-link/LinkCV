#!/bin/sh
# 下载评测用的仿真网申页与标准答案（bzhengak/nw-autofill，GPL-3.0）。
# 只下载到本地 .data/ 目录，不提交进本仓库。
set -eu
cd "$(dirname "$0")"
BASE=https://raw.githubusercontent.com/bzhengak/nw-autofill/HEAD
FORMS="antd-cn element-cn legacy-native-cn moka-flat-degree moka-klook-cn moka-kpmg-en plain-cn sea-selfbuilt-en sf-plain-en sf-portal-en workday-hkex-cn"
mkdir -p .data/test-forms .data/tools/expected
for n in $FORMS; do
  curl -fsSL -o ".data/test-forms/$n.html" "$BASE/test-forms/$n.html"
  curl -fsSL -o ".data/tools/expected/$n.json" "$BASE/tools/expected/$n.json"
done
echo "已下载 $(ls .data/test-forms | wc -l) 张表单到 eval/.data"
