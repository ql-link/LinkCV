"""Template PDF structure and low-resolution PDFium visual regression gate.

The fixture is deliberately synthetic and lives in this test. It exercises the
same Markdown/layout primitives for every enabled template without depending
on a database, Dev middleware, MinIO, or a real user's resume.

Run with ``UPDATE_TEMPLATE_BASELINES=1`` only when a reviewer has inspected the
resulting PNGs. The committed baselines are small (320px wide) so this gate is
useful in CI without adding large screenshots to the repository.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pypdfium2 as pdfium
import pytest
from PIL import Image, ImageChops

from linkcv.domain.resume import (
    CanonicalResumeDocument,
    ResumePresentation as CanonicalResumePresentation,
    compile_layout_plan,
)
from linkcv.domain.resume.legacy_cutover import (
    convert_legacy_document,
    convert_legacy_template,
    presentation_for_legacy,
)
from linkcv.domain.resume_document import ResumeDocument
from linkcv.domain.resume_style import ResumePresentation as LegacyResumePresentation


REPO_ROOT = Path(__file__).resolve().parents[5]
WEB_ROOT = REPO_ROOT / "apps" / "web"
CLI = WEB_ROOT / "dist-server" / "render-resume-pdf.cjs"
BASELINE_DIR = Path(__file__).with_name("template_baselines")
VISUAL_WIDTH = 320
MAX_MEAN_PIXEL_ERROR = 3.0
MAX_CHANGED_PIXEL_RATIO = 0.012


TEMPLATE_CASES = (
    ("classic-cn", "classic", 14, 1.55, "#2F4858", False, 14, 16, 14, 16),
    ("modern-two-column-cn", "modern", 13.5, 1.5, "#315C6B", False, 12, 14, 12, 14),
    ("compact-tech-cn", "compact", 12.5, 1.38, "#263238", True, 10, 12, 10, 12),
    ("classic-technical-cn", "classic-technical", 9.5, 1.25, "#202632", True, 9, 11, 9, 11),
    ("administrative-sidebar-cn", "administrative-sidebar", 10, 1.42, "#294F73", True, 0, 0, 0, 0),
    ("campus-professional-cn", "campus-professional", 9.4, 1.38, "#4F8DF7", True, 8, 9, 8, 9),
    ("civic-service-cn", "civic-service", 9.7, 1.45, "#3476D2", True, 0, 10, 8, 10),
    ("creative-orange-cn", "creative-orange", 9.6, 1.4, "#FF8A00", True, 0, 10, 8, 10),
)

LEGACY_TEMPLATE_AVATARS = (
    ("administrative-sidebar-cn", "/templates/avatar-administrative.svg"),
    ("campus-professional-cn", "/templates/avatar-campus.svg"),
    ("civic-service-cn", "/templates/avatar-civic.svg"),
    ("creative-orange-cn", "/templates/avatar-creative.svg"),
)


def render_request(
    template: tuple[object, ...],
    *,
    avatar_override: str | None = None,
) -> dict[str, object]:
    key, _, font_size, line_height, accent, smart, top, _, _, left = template
    avatar = avatar_override or (
        "/templates/avatar-cat.jpg"
        if key in {
            "administrative-sidebar-cn",
            "campus-professional-cn",
            "civic-service-cn",
            "creative-orange-cn",
        }
        else None
    )
    content = (
        "**星河云科技有限公司 · Java 开发实习生**\n\n"
        "- 负责简历编辑器与 PDF 导出链路的测试与实现。\n"
        "- 使用 TypeScript、FastAPI 和 Chromium 完成稳定渲染。\n\n"
        "杭州 · 2024.06 - 2025.06 · 远程 · 全职\n\n"
        "技术栈：TypeScript / FastAPI / Chromium"
    )
    data = {
        "basics": {
            "name": "张三",
            "headline": "软件工程实习生",
            "email": None,
            "phone": None,
            "location": None,
            "photo": None,
            "summary": None,
            "links": [],
        },
        "sections": {
            "work_experiences": [],
            "educations": [],
            "projects": [],
            "skills": [],
            "certificates": [],
            "awards": [],
            "languages": [],
            "custom_sections": [{
                "id": "quality-gate",
                "title": "模板质量门禁",
                "items": [{
                    "id": "quality-item",
                    "title": None,
                    "subtitle": None,
                    "content": {"format": "markdown", "content": content},
                    "source_refs": [],
                }],
            }],
        },
        "semantic_sections": [
            {
                "id": "semantic_basics",
                "semantic_kind": "basics",
                "display_title": "基本信息",
                "semantic_source": "system",
                "semantic_confidence": None,
                "content_key": "basics",
                "custom_section_id": None,
            },
            {
                "id": "semantic_quality-gate",
                "semantic_kind": "custom",
                "display_title": "模板质量门禁",
                "semantic_source": "system",
                "semantic_confidence": None,
                "content_key": "custom_sections",
                "custom_section_id": "quality-gate",
            },
        ],
    }
    style = {
        "template_key": key,
        "font_family": "source-han-serif",
        "font_size": font_size,
        "line_height": line_height,
        "accent_color": accent,
        "smart_one_page": smart,
        "page": {
            "size": "A4",
            "margin_top_mm": top,
            "margin_right_mm": left,
            "margin_bottom_mm": top,
            "margin_left_mm": left,
        },
        "section_order": ["basics", "custom_sections"],
        "manifest": {
            "renderer_key": "flow",
            "regions": [{"id": "main", "kind": "main", "order": 1}],
            "slots": [{
                "id": "main-content",
                "region_id": "main",
                "accepts": ["basics", "custom", *(["avatar"] if avatar else [])],
                "required": False,
                "fallback": True,
                "order": 0,
            }],
            "avatar": {
                "visibility": "show" if avatar else "hide",
                "fallback_asset": "none",
                "size": 72,
            },
        },
    }
    legacy_data = ResumeDocument.model_validate(data)
    legacy_style = LegacyResumePresentation.model_validate(style)
    definition = convert_legacy_template(legacy_style, template_key=str(key))
    canonical_data = convert_legacy_document(legacy_data)
    if avatar:
        canonical_payload = canonical_data.model_dump(mode="json")
        identity = canonical_payload["identity"]
        assert isinstance(identity, dict)
        identity["avatar"] = {
            "node_id": "node_templateavatar0001",
            "source_refs": [],
            "media_kind": "avatar",
            "src": avatar,
            "alt": "模板头像",
            "width": 72,
            "width_unit": "px",
            "height_px": 72,
            "align": None,
            "system_fallback": False,
        }
        canonical_data = CanonicalResumeDocument.model_validate(canonical_payload)
    canonical_style = presentation_for_legacy(legacy_style, definition)
    layout_plan = compile_layout_plan(canonical_data, definition, canonical_style)
    return {
        "protocol_version": 1,
        "title": f"模板质量门禁 - {key}",
        "data": canonical_data.model_dump(mode="json"),
        "style": canonical_style.model_dump(mode="json"),
        "layout_plan": layout_plan.model_dump(mode="json"),
    }


def _refresh_layout(payload: dict[str, object]) -> None:
    data = CanonicalResumeDocument.model_validate(payload["data"])
    style = CanonicalResumePresentation.model_validate(payload["style"])
    payload["layout_plan"] = compile_layout_plan(
        data, style.template_snapshot, style
    ).model_dump(mode="json")


def _ensure_cli() -> None:
    # Always rebuild so a targeted test cannot accidentally validate a stale,
    # ignored dist-server artifact left by an earlier source revision.
    subprocess.run(
        ["npm", "run", "build:pdf-cli"],
        cwd=WEB_ROOT,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _render_pdf(payload: dict[str, object]) -> bytes:
    result = subprocess.run(
        ["node", str(CLI)],
        cwd=WEB_ROOT,
        input=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        text=False,
        capture_output=True,
        check=False,
        env=os.environ.copy(),
    )
    if result.returncode != 0:
        raise AssertionError(f"template renderer failed: {result.stderr.decode(errors='replace')}")
    assert result.stdout.startswith(b"%PDF-")
    return result.stdout


def _render_thumbnail(pdf_bytes: bytes) -> Image.Image:
    document = pdfium.PdfDocument(pdf_bytes)
    assert len(document) == 1, "visual baselines require one-page template fixtures"
    page = document[0]
    width, height = page.get_size()
    bitmap = page.render(scale=VISUAL_WIDTH / width)
    image = bitmap.to_pil().convert("RGB")
    document.close()
    return image


def _assert_visual_baseline(name: str, image: Image.Image) -> None:
    baseline_path = BASELINE_DIR / f"{name}.png"
    if os.environ.get("UPDATE_TEMPLATE_BASELINES") == "1":
        BASELINE_DIR.mkdir(parents=True, exist_ok=True)
        image.save(baseline_path, format="PNG", optimize=True)
        return
    if not baseline_path.is_file():
        pytest.fail(f"missing visual baseline {baseline_path}; review and run UPDATE_TEMPLATE_BASELINES=1")
    with Image.open(baseline_path) as baseline_file:
        baseline = baseline_file.convert("RGB")
    assert image.size == baseline.size
    difference = ImageChops.difference(image, baseline)
    pixels = list(difference.get_flattened_data())
    mean_error = sum(sum(pixel) / 3 for pixel in pixels) / len(pixels)
    changed_ratio = sum(1 for pixel in pixels if max(pixel) > 8) / len(pixels)
    assert mean_error <= MAX_MEAN_PIXEL_ERROR, f"{name}: mean pixel error {mean_error:.3f}"
    assert changed_ratio <= MAX_CHANGED_PIXEL_RATIO, f"{name}: changed pixel ratio {changed_ratio:.4f}"


def test_all_enabled_templates_have_stable_pdf_structure_and_visual_baselines() -> None:
    _ensure_cli()
    for template in TEMPLATE_CASES:
        name = str(template[0])
        payload = render_request(template)
        pdf_bytes = _render_pdf(payload)
        document = pdfium.PdfDocument(pdf_bytes)
        assert len(document) == 1, name
        page = document[0]
        width, height = page.get_size()
        assert width == pytest.approx(595.28, abs=1.5), name
        assert height >= 841.89 - 1.5, name
        document.close()
        _assert_visual_baseline(name, _render_thumbnail(pdf_bytes))


def test_canonical_avatar_assets_remain_renderable() -> None:
    _ensure_cli()
    templates_by_key = {str(template[0]): template for template in TEMPLATE_CASES}
    for template_key, avatar in LEGACY_TEMPLATE_AVATARS:
        pdf_bytes = _render_pdf(
            render_request(templates_by_key[template_key], avatar_override=avatar)
        )
        assert pdf_bytes.startswith(b"%PDF-"), template_key


def test_short_smart_resume_with_small_vertical_margin_stays_on_one_page() -> None:
    _ensure_cli()
    campus_template = next(
        template for template in TEMPLATE_CASES if template[0] == "campus-professional-cn"
    )
    payload = render_request(campus_template)
    style = payload["style"]
    assert isinstance(style, dict)
    portable = style["portable"]
    assert isinstance(portable, dict)
    portable["vertical_page_margin_mm"] = 6

    data = payload["data"]
    assert isinstance(data, dict)
    data["sections"] = [{
        "node_id": "node_shortsection0001",
        "source_refs": [],
        "semantic_kind": "profile",
        "title": {
            "node_id": "node_shorttitle000001",
            "source_refs": [],
            "value": "简介",
        },
        "entries": [],
        "blocks": [{
            "node_id": "node_shortparagraph001",
            "source_refs": [],
            "block_type": "paragraph",
            "runs": [{
                "inline_type": "text",
                "text": "专注于可靠的软件交付。",
                "marks": [],
                "href": None,
                "style": {"color": None, "font_size_pt": None, "highlight_color": None},
            }],
        }],
    }]
    _refresh_layout(payload)

    document = pdfium.PdfDocument(_render_pdf(payload))
    assert len(document) == 1
    width, height = document[0].get_size()
    assert width == pytest.approx(595.28, abs=1.5)
    assert height == pytest.approx(841.89, abs=1.5)
    document.close()


def test_standard_resume_still_fragments_long_content_across_a4_pages() -> None:
    _ensure_cli()
    payload = render_request(TEMPLATE_CASES[0])
    data = payload["data"]
    assert isinstance(data, dict)
    data["sections"] = [{
        "node_id": "node_longsection00001",
        "source_refs": [],
        "semantic_kind": "project",
        "title": {
            "node_id": "node_longtitle0000001",
            "source_refs": [],
            "value": "项目经历",
        },
        "entries": [],
        "blocks": [{
            "node_id": "node_longlist00000001",
            "block_type": "bullet_list",
            "start": None,
            "items": [{
                "node_id": f"node_longitem{index:08d}",
                "source_refs": [],
                "runs": [{
                    "inline_type": "text",
                    "text": f"第 {index:03d} 项：负责稳定的简历编辑与 PDF 导出。",
                    "marks": [],
                    "href": None,
                    "style": {"color": None, "font_size_pt": None, "highlight_color": None},
                }],
            } for index in range(1, 121)],
        }],
    }]
    _refresh_layout(payload)

    document = pdfium.PdfDocument(_render_pdf(payload))
    assert len(document) >= 2
    page_texts: list[str] = []
    for page in document:
        text_page = page.get_textpage()
        page_texts.append(text_page.get_text_bounded())
        text_page.close()
    text = "".join(page_texts)
    assert "第 001 项" in text
    assert "第 120 项" in text
    document.close()
