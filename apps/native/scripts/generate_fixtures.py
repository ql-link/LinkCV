"""生成原生客户端共享的 mock 数据。

从迁移 0079 的内置模板里取三套（示例内容全部虚构），用后端自己的布局编译器
算出 layout_plan，写成和 `GET /api/resume-templates` 同形状的 JSON。这样 Mac 和
Windows 客户端在没有后端的情况下，也能用真实的数据结构驱动纸面渲染。

运行：uv run --directory apps/backend python ../native/scripts/generate_fixtures.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from linkresume.application.resumes.service import parse_persisted_template_snapshot
from linkresume.domain.resume import compile_layout_plan

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / "apps/backend/migrations/sql/0079.up.sql"
OUTPUT = ROOT / "apps/native/shared/fixtures/resume-templates.json"
PICKED = ("featured-campus-cn", "featured-professional-cn", "featured-product-cn")
ROW = re.compile(
    r"\('(featured-[a-z-]+)', '([^']+)', '([^']*)',\s*CAST\('(.*?)' AS JSON\),\s*CAST\('(.*?)' AS JSON\)",
    re.S,
)


def main() -> None:
    rows = {match[0]: match for match in ROW.findall(MIGRATION.read_text(encoding="utf-8"))}
    templates = []
    for index, key in enumerate(PICKED, start=1):
        _, name, description, data_json, style_json = rows[key]
        snapshot = parse_persisted_template_snapshot(data_json, style_json)
        plan = compile_layout_plan(snapshot.data, snapshot.style)
        templates.append({
            "id": str(index),
            "key": key,
            "name": name,
            "description": description,
            "style_categories": [],
            "use_cases": [],
            "data": snapshot.data_json,
            "style": snapshot.style_json,
            "layout_plan": plan.model_dump(mode="json"),
        })
    OUTPUT.write_text(json.dumps({"templates": templates}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(templates)} templates -> {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
