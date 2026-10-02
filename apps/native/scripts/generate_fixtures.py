"""生成原生客户端共享的 mock 数据。

从迁移 0079 的三套旧模板与 0100 的代表 Muse 模板（示例内容全部虚构），用后端自己的布局编译器
算出 layout_plan，写成和 `GET /api/resume-templates` 同形状的 JSON。这样 Mac 和
Windows 客户端在没有后端的情况下，也能用真实的数据结构驱动纸面渲染。

运行：uv run --directory apps/backend python ../native/scripts/generate_fixtures.py
"""

from __future__ import annotations

from copy import deepcopy
import json
import re
from pathlib import Path

from linkresume.application.resumes.service import parse_persisted_template_snapshot
from linkresume.domain.resume import compile_layout_plan

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / "apps/backend/migrations/sql/0079.up.sql"
OUTPUT = ROOT / "apps/native/shared/fixtures/resume-templates.json"
PICKED = (
    "featured-campus-cn", "featured-professional-cn", "featured-product-cn",
    "muse-badge-cn", "muse-hello-cn", "muse-code-cn", "muse-polaroid-cn",
    "muse-blackmast-cn", "muse-triptych-cn",
)
ROW = re.compile(
    r"\('(featured-[a-z-]+)', '([^']+)', '([^']*)',\s*CAST\('(.*?)' AS JSON\),\s*CAST\('(.*?)' AS JSON\)",
    re.S,
)


def main() -> None:
    rows = {match[0]: match for match in ROW.findall(MIGRATION.read_text(encoding="utf-8"))}
    muse_sql = (ROOT / "apps/backend/migrations/sql/0100.up.sql").read_text(encoding="utf-8")
    samples = dict(re.findall(r"SET @muse_sample_(\w+) = CAST\('((?:[^']|'')*)' AS JSON\)", muse_sql))
    muse_rows = re.findall(
        r"VALUES \('(muse-[a-z]+-cn)', '((?:[^']|'')*)', '((?:[^']|'')*)', "
        r"@muse_sample_(\w+), CAST\('((?:[^']|'')*)' AS JSON\)", muse_sql
    )
    assert len(muse_rows) == 79, "Muse catalog extraction incomplete"
    for key, name, description, sample, style in muse_rows:
        rows[key] = (key, name.replace("''", "'"), description.replace("''", "'"), samples[sample].replace("''", "'"), style.replace("''", "'"))
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
    validation_cases = []
    for font in ("source-han-serif", "lxgw-wenkai", "Native Missing Fixture Font"):
        case = deepcopy(templates[3])
        case["name"] = "字体回退：" + font
        case["style"]["tokens"]["font_family"] = font
        snapshot = parse_persisted_template_snapshot(case["data"], case["style"])
        case["layout_plan"] = compile_layout_plan(snapshot.data, snapshot.style).model_dump(mode="json")
        validation_cases.append(case)
    case = deepcopy(templates[3])
    case["name"] = "长正文滚动边界"
    case["data"]["sections"][0]["blocks"][0]["runs"][0]["text"] = ("长正文校验：内容应完整保留，能够滚动至末尾。" * 180) + "长正文结束标记"
    snapshot = parse_persisted_template_snapshot(case["data"], case["style"])
    case["layout_plan"] = compile_layout_plan(snapshot.data, snapshot.style).model_dump(mode="json")
    validation_cases.append(case)
    # Use the canonical avatar and a fresh plan; private bytes arrive via assets, not WebView networking.
    case = deepcopy(templates[0])
    case["name"] = "私有图片 assets 注入"
    source = "/api/resumes/42/assets/fixture.png"
    case["data"]["identity"]["avatar"] = {
        "node_id": "node_private000000000000000001", "source_refs": [],
        "media_kind": "avatar", "src": source, "alt": "虚构私有头像",
        "width": 108, "width_unit": "px", "height_px": None,
        "align": None, "system_fallback": False,
    }
    case["assets"] = {source: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgmJn2HwADmwH/sEIMpQAAAABJRU5ErkJggg=="}
    snapshot = parse_persisted_template_snapshot(case["data"], case["style"])
    case["layout_plan"] = compile_layout_plan(snapshot.data, snapshot.style).model_dump(mode="json")
    validation_cases.append(case)
    (OUTPUT.parent / "paper-validation.json").write_text(json.dumps(validation_cases, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    output = json.dumps({"templates": templates}, ensure_ascii=False, indent=2) + "\n"
    targets = [OUTPUT, ROOT / "apps/mac/Sources/LinkResumeCore/Resources/resume-templates.json",
               ROOT / "apps/windows/src/LinkResume.Core/Resources/resume-templates.json"]
    for target in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(output, encoding="utf-8")
    print(f"wrote {len(templates)} templates -> {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
