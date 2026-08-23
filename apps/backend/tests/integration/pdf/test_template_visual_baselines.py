"""Template PDF structure and low-resolution PDFium visual regression gate.

The fixture is deliberately synthetic and lives in this test. It exercises the
same Markdown/layout primitives for every enabled template without depending
on a database, Dev middleware, MinIO, or a real user's resume.

Run with ``UPDATE_TEMPLATE_BASELINES=1`` only when a reviewer has inspected the
resulting PNGs. The committed baselines are small (320px wide) so this gate is
useful in CI without adding large screenshots to the repository.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
from pathlib import Path

import pypdfium2 as pdfium
import pytest
from PIL import Image, ImageChops


REPO_ROOT = Path(__file__).resolve().parents[5]
WEB_ROOT = REPO_ROOT / "apps" / "web"
CLI = WEB_ROOT / "dist-server" / "render-resume-pdf.cjs"
BASELINE_DIR = Path(__file__).with_name("template_baselines")
VISUAL_WIDTH = 320
MAX_MEAN_PIXEL_ERROR = 3.0
MAX_CHANGED_PIXEL_RATIO = 0.012


TEMPLATE_CASES = (
    ("blank-cn", "blank", 14, 1.55, "#2F4858", False, 14, 16, 14, 16),
    ("classic-cn", "classic", 14, 1.55, "#2F4858", False, 14, 16, 14, 16),
    ("modern-two-column-cn", "modern", 13.5, 1.5, "#315C6B", False, 12, 14, 12, 14),
    ("compact-tech-cn", "compact", 12.5, 1.38, "#263238", True, 10, 12, 10, 12),
    ("classic-technical-cn", "classic-technical", 11.5, 1.42, "#2F4858", True, 12, 14, 12, 14),
    ("administrative-sidebar-cn", "administrative-sidebar", 10, 1.42, "#294F73", True, 0, 0, 0, 0),
    ("campus-professional-cn", "campus-professional", 9.4, 1.38, "#4F8DF7", True, 8, 9, 8, 9),
    ("civic-service-cn", "civic-service", 9.7, 1.45, "#3476D2", True, 0, 10, 8, 10),
    ("creative-orange-cn", "creative-orange", 9.6, 1.4, "#FF8A00", True, 0, 10, 8, 10),
)


def render_request(template: tuple[object, ...]) -> dict[str, object]:
    key, _, font_size, line_height, accent, smart, top, right, bottom, left = template
    avatar = {
        "administrative-sidebar-cn": "/templates/avatar-administrative.png",
        "campus-professional-cn": "/templates/avatar-campus.png",
        "civic-service-cn": "/templates/avatar-civic.png",
        "creative-orange-cn": "/templates/avatar-creative.png",
    }.get(str(key))
    content = (
        "::: left 55\n"
        "星河云科技有限公司\n"
        ":::\n\n"
        "::: right\n"
        "Java 开发实习生\n"
        ":::\n\n"
        "- 负责简历编辑器与 PDF 导出链路的测试与实现。\n"
        "- 使用 TypeScript、FastAPI 和 Chromium 完成稳定渲染。\n\n"
        ":::: meta\n"
        "杭州\n2024.06 - 2025.06\n远程\n全职\n"
        "::::\n\n"
        ":::: trio\n"
        "TypeScript\nFastAPI\nChromium\n"
        "::::"
    )
    if avatar:
        content = f'![头像]({avatar} "linkcv-avatar:72")\n\n{content}'
    data = {
        "schema_version": "1.0",
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
    }
    return {
        "protocol_version": 1,
        "title": f"模板质量门禁 - {key}",
        "data": data,
        "style": {
            "schema_version": "1.0",
            "template_key": key,
            "font_family": "source-han-serif",
            "font_size": font_size,
            "line_height": line_height,
            "accent_color": accent,
            "smart_one_page": smart,
            "page": {
                "size": "A4",
                "margin_top_mm": top,
                "margin_right_mm": right,
                "margin_bottom_mm": bottom,
                "margin_left_mm": left,
            },
            "section_order": ["basics", "custom_sections"],
        },
    }


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
