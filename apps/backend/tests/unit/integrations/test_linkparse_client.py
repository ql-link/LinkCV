import asyncio
import json
from time import monotonic

import httpx
import pytest

from linkcv.domain.document_conversion import DocumentConversionFailure
from linkcv.integrations.linkparse_client import LinkParseClient


def client(handler, *, key="fixture-key", response_max_bytes=1024 * 1024):
    return LinkParseClient(
        base_url="https://linkparse.example.invalid",
        api_key=key,
        parse_path="/v1/parse",
        timeout_seconds=60,
        response_max_bytes=response_max_bytes,
        markdown_max_bytes=1024 * 1024,
        transport=httpx.MockTransport(handler),
    )


def response_payload(request_id: str, **overrides):
    markdown = overrides.get(
        "outputs",
        {},
    ).get("markdown", "# 张三\n\n## 经历\n" + "可靠的简历正文" * 30)
    layout_blocks = []
    for source_order, line in enumerate(
        line for line in markdown.splitlines() if line.strip()
    ):
        stripped = line.strip()
        if stripped.startswith("## "):
            role = "heading"
            heading_level = 2
            text = stripped[3:]
        elif stripped.startswith("# "):
            role = "heading"
            heading_level = 1
            text = stripped[2:]
        elif stripped[:2].isdigit() and ". " in stripped:
            role = "ordered_list_item"
            heading_level = None
            text = stripped
        elif stripped.startswith("- "):
            role = "bullet_list_item"
            heading_level = None
            text = stripped
        else:
            role = "paragraph"
            heading_level = None
            text = stripped
        layout_blocks.append(
            {
                "block_id": f"line-{source_order}",
                "source_order": source_order,
                "source_page": 1,
                "role": role,
                "heading_level": heading_level,
                "text": text,
                "bbox": [0, source_order / 100, 0.5, source_order / 100 + 0.005],
                "row_id": None,
                "continuation_of": None,
                "join_with": "",
                "confidence": 1,
                "role_source": "opendataloader",
            }
        )
    payload = {
        "request_id": request_id,
        "filename": "resume.pdf",
        "engine": "opendataloader",
        "detected_type": "text_pdf",
        "outputs": {"markdown": markdown},
        "assets": [],
        "meta": {
            "page_count": 2,
            "duration_ms": 25,
            "pdf": {
                "layout": {
                    "schema_version": 1,
                    "blocks": layout_blocks,
                    "quality": {
                        "status": "passed",
                        "source_line_count": len(layout_blocks),
                        "output_block_count": len(layout_blocks),
                        "heading_count": sum(
                            block["role"] == "heading" for block in layout_blocks
                        ),
                        "row_group_count": 0,
                        "warnings": [],
                    },
                }
            },
        },
    }
    payload.update(overrides)
    return payload


def run_parse(
    instance: LinkParseClient,
    *,
    source_format="pdf",
    require_layout: bool = True,
):
    parse = instance.parse_docx if source_format == "docx" else instance.parse_pdf
    arguments = {
        "filename": f"resume.{source_format}",
        "content": (b"PK fixture" if source_format == "docx" else b"%PDF-1.7 fixture"),
        "operation_id": "operation-1",
        "deadline_monotonic": monotonic() + 120,
    }
    if source_format == "pdf":
        arguments["require_layout"] = require_layout
    return asyncio.run(parse(**arguments))


def test_linkparse_legacy_pdf_does_not_request_or_validate_resume_layout() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.read()
        request_id = request.headers["X-Request-ID"]
        payload = response_payload(request_id)
        payload["meta"]["pdf"]["layout"] = {
            "schema_version": "malformed-unrequested-layout"
        }
        return httpx.Response(
            200,
            headers={"X-Request-ID": request_id},
            json=payload,
        )

    result = run_parse(client(handler), require_layout=False)

    assert b'name="include_layout"' not in captured["body"]
    assert result.layout_applied is False
    assert result.layout_schema_version is None
    assert result.markdown.startswith("# 张三")


def layout_block(
    source_order: int,
    role: str,
    text: str,
    *,
    heading_level: int | None = None,
    row_id: str | None = None,
    continuation_of: str | None = None,
    join_with: str = "",
    source_page: int = 1,
    y: float | None = None,
    x0: float = 0,
    x1: float = 0.5,
) -> dict:
    top = source_order / 100 if y is None else y
    return {
        "block_id": f"line-{source_order}",
        "source_order": source_order,
        "source_page": source_page,
        "role": role,
        "heading_level": heading_level,
        "text": text,
        "bbox": [x0, top, x1, top + 0.005],
        "row_id": row_id,
        "continuation_of": continuation_of,
        "join_with": join_with,
        "confidence": 0.98,
        "role_source": "ocr",
    }


def set_layout(
    payload: dict, blocks: list[dict], *, warnings: list[str] | None = None
) -> None:
    payload["meta"]["pdf"] = {
        "layout": {
            "schema_version": 1,
            "blocks": blocks,
            "quality": {
                "status": "passed",
                "source_line_count": len(blocks),
                "output_block_count": len(blocks),
                "heading_count": sum(block["role"] == "heading" for block in blocks),
                "row_group_count": len(
                    {block["row_id"] for block in blocks if block["row_id"]}
                ),
                "warnings": warnings or [],
            },
        }
    }


def test_linkparse_sends_fixed_minimal_contract_and_maps_ocr_warning() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        body = request.read()
        captured["body"] = body
        request_id = request.headers["X-Request-ID"]
        return httpx.Response(
            200,
            headers={"X-Request-ID": request_id},
            json=response_payload(request_id, detected_type="mixed_pdf"),
        )

    result = run_parse(client(handler))

    request = captured["request"]
    body = captured["body"]
    assert request.url.path == "/v1/parse"
    assert request.headers["Authorization"] == "Bearer fixture-key"
    assert b'name="output_formats"\r\n\r\nmarkdown' in body
    assert b'name="include_bbox"\r\n\r\nfalse' in body
    assert b'name="include_images"\r\n\r\nfalse' in body
    assert b'name="include_layout"\r\n\r\ntrue' in body
    assert b'name="engine"' not in body
    assert b'name="ocr"' not in body
    assert b'name="dpi"' not in body
    assert result.page_count == 2
    assert result.detected_type == "mixed_pdf"
    assert result.layout_applied is True
    assert result.layout_schema_version == 1
    assert result.warnings == ["pdf_ocr_applied"]


def test_linkparse_parses_docx_with_shared_contract_and_image_warning() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.read()
        request_id = request.headers["X-Request-ID"]
        return httpx.Response(
            200,
            headers={"X-Request-ID": request_id},
            json=response_payload(
                request_id,
                filename="resume.docx",
                engine="mammoth_word",
                detected_type="docx",
                meta={
                    "page_count": 3,
                    "duration_ms": 31,
                    "word": {
                        "omitted_image_count": 2,
                        "table_failure_count": 1,
                        "formula_count": 1,
                        "producer_extension_counter": 7,
                    },
                },
            ),
        )

    result = run_parse(client(handler), source_format="docx")

    assert (
        b"application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        in captured["body"]
    )
    assert result.source_format == "docx"
    assert result.parser == "mammoth_word"
    assert result.parser_version == "linkparse-v0.2.0"
    assert result.page_count == 3
    assert result.ocr_applied is False
    assert result.layout_applied is False
    assert b'name="include_layout"' not in captured["body"]
    assert result.warnings == [
        "docx_embedded_images_omitted",
        "docx_table_content_present",
    ]


def test_linkparse_keeps_evolving_outer_pdf_metadata_compatible() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        request_id = request.headers["X-Request-ID"]
        payload = response_payload(request_id)
        payload["meta"]["pdf"].update(
            {
                "pipeline": "opendataloader_ocr",
                "opendataloader": {"engine": "fixture"},
                "initial_quality": {"status": "PASSED"},
                "final_quality": {"status": "PASSED"},
                "ocr_pages": [1],
                "structure": {"schema_version": 1},
                "page_provenance_complete": True,
                "warnings": [],
            }
        )
        return httpx.Response(
            200,
            headers={"X-Request-ID": request_id},
            json=payload,
        )

    result = run_parse(client(handler))

    assert result.layout_applied is True
    assert result.detected_type == "text_pdf"


def test_linkparse_docx_maps_table_metadata_without_exposing_unrelated_metadata() -> (
    None
):
    def handler(request: httpx.Request) -> httpx.Response:
        request_id = request.headers["X-Request-ID"]
        return httpx.Response(
            200,
            headers={"X-Request-ID": request_id},
            json=response_payload(
                request_id,
                detected_type="docx",
                engine="mammoth_word",
                meta={
                    "page_count": 1,
                    "duration_ms": 8,
                    "word": {
                        "omitted_image_count": 0,
                        "table_failure_count": 3,
                        "comment_removed_count": 4,
                    },
                },
            ),
        )

    result = run_parse(client(handler), source_format="docx")

    assert result.warnings == ["docx_table_content_present"]


@pytest.mark.parametrize(
    ("status", "code", "expected_status", "expected_code"),
    [
        (401, "UNAUTHORIZED", 503, "DOCUMENT_CONVERSION_UNAVAILABLE"),
        (503, "ENGINE_UNAVAILABLE", 503, "DOCUMENT_CONVERSION_UNAVAILABLE"),
        (429, "CONCURRENCY_LIMIT_REACHED", 503, "DOCUMENT_CONVERSION_UNAVAILABLE"),
        (422, "WORD_PARSE_FAILED", 422, "IMPORT_CONTENT_INVALID"),
        (422, "INVALID_WORD_DOCUMENT", 422, "IMPORT_CONTENT_INVALID"),
        (415, "UNSUPPORTED_FILE_TYPE", 415, "UNSUPPORTED_IMPORT_FORMAT"),
    ],
)
def test_linkparse_docx_maps_known_error_envelopes(
    status: int,
    code: str,
    expected_status: int,
    expected_code: str,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status,
            headers={"X-Request-ID": request.headers["X-Request-ID"]},
            json={"error": {"code": code, "message": "sensitive detail"}},
        )

    with pytest.raises(DocumentConversionFailure) as raised:
        run_parse(client(handler), source_format="docx")
    assert raised.value.status_code == expected_status
    assert raised.value.code == expected_code
    assert "sensitive detail" not in str(raised.value)


@pytest.mark.parametrize(
    ("status", "code", "expected_status", "expected_code"),
    [
        (401, "UNAUTHORIZED", 503, "DOCUMENT_CONVERSION_UNAVAILABLE"),
        (503, "ENGINE_UNAVAILABLE", 503, "DOCUMENT_CONVERSION_UNAVAILABLE"),
        (429, "CONCURRENCY_LIMIT_REACHED", 503, "DOCUMENT_CONVERSION_UNAVAILABLE"),
        (413, "PDF_TOO_MANY_PAGES", 413, "IMPORT_FILE_TOO_LARGE"),
        (413, "LAYOUT_RESOURCE_LIMIT", 422, "RESUME_LAYOUT_UNSUPPORTED"),
        (415, "UNSUPPORTED_FILE_TYPE", 415, "UNSUPPORTED_IMPORT_FORMAT"),
        (422, "PDF_RENDER_FAILED", 422, "IMPORT_CONTENT_INVALID"),
        (422, "WORD_PARSE_FAILED", 422, "IMPORT_CONTENT_INVALID"),
        (422, "INVALID_WORD_DOCUMENT", 422, "IMPORT_CONTENT_INVALID"),
        (422, "OCR_FAILED", 502, "DOCUMENT_CONVERSION_FAILED"),
        (500, "INTERNAL_ERROR", 502, "DOCUMENT_CONVERSION_FAILED"),
    ],
)
def test_linkparse_maps_known_error_envelopes(
    status: int,
    code: str,
    expected_status: int,
    expected_code: str,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status,
            headers={"X-Request-ID": request.headers["X-Request-ID"]},
            json={"error": {"code": code, "message": "sensitive detail"}},
        )

    with pytest.raises(DocumentConversionFailure) as raised:
        run_parse(client(handler))
    assert raised.value.status_code == expected_status
    assert raised.value.code == expected_code
    assert "sensitive detail" not in str(raised.value)


@pytest.mark.parametrize("invalid_kind", ["request_id", "assets", "json", "size"])
def test_linkparse_rejects_invalid_or_oversized_responses(invalid_kind: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        request_id = request.headers["X-Request-ID"]
        if invalid_kind == "json":
            return httpx.Response(200, headers={"X-Request-ID": request_id}, text="{")
        payload = response_payload(request_id)
        if invalid_kind == "request_id":
            payload["request_id"] = "different"
        if invalid_kind == "assets":
            payload["assets"] = [{"url": "https://public.example.invalid/image.png"}]
        if invalid_kind == "size":
            payload["outputs"] = {"markdown": "x" * 2000}
        return httpx.Response(
            200,
            headers={"X-Request-ID": request_id},
            content=json.dumps(payload).encode(),
        )

    instance = client(
        handler, response_max_bytes=1000 if invalid_kind == "size" else 1_000_000
    )
    with pytest.raises(DocumentConversionFailure) as raised:
        run_parse(instance)
    assert raised.value.code == "DOCUMENT_CONVERSION_FAILED"


def test_linkparse_rejects_response_with_missing_required_field() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        request_id = request.headers["X-Request-ID"]
        payload = response_payload(request_id)
        del payload["meta"]
        return httpx.Response(
            200,
            headers={"X-Request-ID": request_id},
            json=payload,
        )

    with pytest.raises(DocumentConversionFailure) as raised:
        run_parse(client(handler))
    assert raised.value.status_code == 502
    assert raised.value.code == "DOCUMENT_CONVERSION_FAILED"


def test_linkparse_maps_timeout_and_bodyless_authentication_failure() -> None:
    def timeout_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("fixture timeout", request=request)

    with pytest.raises(DocumentConversionFailure) as timed_out:
        run_parse(client(timeout_handler))
    assert timed_out.value.status_code == 504
    assert timed_out.value.code == "DOCUMENT_CONVERSION_TIMEOUT"

    def auth_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, content=b"")

    with pytest.raises(DocumentConversionFailure) as unauthorized:
        run_parse(client(auth_handler))
    assert unauthorized.value.status_code == 503
    assert unauthorized.value.code == "DOCUMENT_CONVERSION_UNAVAILABLE"


def test_linkparse_rejects_unusable_markdown_and_missing_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        request_id = request.headers["X-Request-ID"]
        return httpx.Response(
            200,
            headers={"X-Request-ID": request_id},
            json=response_payload(request_id, outputs={"markdown": " \ufffd "}),
        )

    with pytest.raises(DocumentConversionFailure) as unusable:
        run_parse(client(handler))
    assert unusable.value.status_code == 422
    assert unusable.value.code == "IMPORT_CONTENT_INVALID"

    with pytest.raises(DocumentConversionFailure) as unavailable:
        run_parse(client(handler, key=""))
    assert unavailable.value.status_code == 503
    assert unavailable.value.code == "DOCUMENT_CONVERSION_UNAVAILABLE"

    network_calls = 0

    def unexpected_handler(request: httpx.Request) -> httpx.Response:
        nonlocal network_calls
        network_calls += 1
        return handler(request)

    with pytest.raises(DocumentConversionFailure) as unavailable_docx:
        run_parse(client(unexpected_handler, key=""), source_format="docx")
    assert unavailable_docx.value.status_code == 503
    assert unavailable_docx.value.code == "DOCUMENT_CONVERSION_UNAVAILABLE"
    assert network_calls == 0


def test_linkparse_marks_usable_short_text_as_low_quality() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        request_id = request.headers["X-Request-ID"]
        return httpx.Response(
            200,
            headers={"X-Request-ID": request_id},
            json=response_payload(
                request_id,
                outputs={"markdown": "# 张三\n\n## 技能\nPython FastAPI MySQL"},
            ),
        )

    result = run_parse(client(handler))

    assert result.warnings == ["pdf_low_text_quality"]


def test_linkparse_rebuilds_trusted_scanned_layout_rows_lists_and_continuation() -> (
    None
):
    markdown = (
        "# 张三\n\n"
        "电话：13800000000 ｜ 邮箱：zhangsan@example.invalid\n\n"
        "## 教育经历\n\n清华大学 ｜ 2020\n\n"
        "## 专业技能\n\n1. Python\n2. FastAPI\n\n"
        "## 工作经历\n\n1. 负责开发并优化性能\n\n"
        "## 项目经历\n\n平台工程项目：" + "可验证的虚构项目说明" * 12
    )
    blocks = [
        layout_block(0, "heading", "张三", heading_level=1, y=0.01),
        layout_block(
            1,
            "paragraph",
            "电话：13800000000",
            row_id="contact-1",
            y=0.1,
        ),
        layout_block(
            2,
            "paragraph",
            "邮箱：zhangsan@example.invalid",
            row_id="contact-1",
            y=0.1,
            x0=0.55,
            x1=0.95,
        ),
        layout_block(3, "heading", "教育经历", heading_level=2, y=0.2),
        layout_block(4, "paragraph", "清华大学 ｜ 2020", y=0.25),
        layout_block(5, "heading", "专业技能", heading_level=2, y=0.3),
        layout_block(6, "ordered_list_item", "1、Python", y=0.35),
        layout_block(7, "ordered_list_item", "2、FastAPI", y=0.4),
        layout_block(8, "heading", "工作经历", heading_level=2, y=0.45),
        layout_block(9, "ordered_list_item", "1、负责开发", y=0.5),
        layout_block(
            10,
            "ordered_list_item",
            "并优化性能",
            continuation_of="line-9",
            join_with="",
            y=0.506,
        ),
        layout_block(11, "heading", "项目经历", heading_level=2, y=0.6),
        layout_block(
            12,
            "paragraph",
            "平台工程项目：" + "可验证的虚构项目说明" * 12,
            y=0.65,
        ),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        request_id = request.headers["X-Request-ID"]
        payload = response_payload(
            request_id,
            detected_type="scanned_pdf",
            outputs={"markdown": markdown},
        )
        set_layout(payload, blocks, warnings=["ocr_used", "row_role_recovered"])
        return httpx.Response(
            200,
            headers={"X-Request-ID": request_id},
            json=payload,
        )

    result = run_parse(client(handler))

    assert result.layout_applied is True
    assert result.detected_type == "scanned_pdf"
    assert "电话：13800000000 ｜ 邮箱：zhangsan@example.invalid" in result.markdown
    assert "1. 负责开发并优化性能" in result.markdown
    assert "1、负责开发" not in result.markdown
    assert result.markdown.index("## 教育经历") < result.markdown.index("## 专业技能")
    assert result.markdown.index("## 专业技能") < result.markdown.index("## 工作经历")
    assert result.markdown.index("## 工作经历") < result.markdown.index("## 项目经历")
    assert result.warnings == ["pdf_ocr_applied"]


def test_linkparse_accepts_strict_cross_page_list_continuation() -> None:
    markdown = "# Experience\n\n1. Implemented parser and preserved layout"
    blocks = [
        layout_block(0, "heading", "Experience", heading_level=1, y=0.05),
        layout_block(
            1,
            "ordered_list_item",
            "1. Implemented parser and",
            source_page=1,
            y=0.9,
        ),
        layout_block(
            2,
            "ordered_list_item",
            "preserved layout",
            continuation_of="line-1",
            join_with=" ",
            source_page=2,
            y=0.05,
        ),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        request_id = request.headers["X-Request-ID"]
        payload = response_payload(request_id, outputs={"markdown": markdown})
        set_layout(payload, blocks, warnings=["continuation_inferred"])
        return httpx.Response(
            200,
            headers={"X-Request-ID": request_id},
            json=payload,
        )

    result = run_parse(client(handler))

    assert result.markdown == markdown


@pytest.mark.parametrize(
    ("target_y", "continuation_y", "continuation_x"),
    [
        (0.7, 0.05, 0),
        (0.9, 0.2, 0),
        (0.9, 0.05, 0.1),
    ],
)
def test_linkparse_rejects_weak_cross_page_continuation(
    target_y: float,
    continuation_y: float,
    continuation_x: float,
) -> None:
    markdown = "# Experience\n\n1. First second"
    blocks = [
        layout_block(0, "heading", "Experience", heading_level=1, y=0.05),
        layout_block(
            1,
            "ordered_list_item",
            "1. First",
            source_page=1,
            y=target_y,
        ),
        layout_block(
            2,
            "ordered_list_item",
            "second",
            continuation_of="line-1",
            join_with=" ",
            source_page=2,
            y=continuation_y,
            x0=continuation_x,
            x1=continuation_x + 0.5,
        ),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        request_id = request.headers["X-Request-ID"]
        payload = response_payload(request_id, outputs={"markdown": markdown})
        set_layout(payload, blocks, warnings=["continuation_inferred"])
        return httpx.Response(
            200,
            headers={"X-Request-ID": request_id},
            json=payload,
        )

    with pytest.raises(DocumentConversionFailure) as raised:
        run_parse(client(handler))

    assert raised.value.code == "RESUME_LAYOUT_UNSUPPORTED"


@pytest.mark.parametrize(
    "failure",
    [
        "missing",
        "degraded",
        "bbox",
        "order",
        "order_gap",
        "page_out_of_range",
        "page_rollback",
        "reference",
        "continuation_gap",
        "continuation_role",
        "heading_continuation",
        "continuation_distance",
        "visual_order",
        "row_reverse",
        "row_overlap",
        "row_barely_vertical",
        "layout_extra",
        "block_extra",
        "quality_extra",
        "count",
        "markdown",
        "warning",
    ],
)
def test_linkparse_rejects_unclosed_pdf_layout_contracts(failure: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        request_id = request.headers["X-Request-ID"]
        payload = response_payload(request_id)
        layout = payload["meta"]["pdf"]["layout"]
        if failure == "missing":
            del payload["meta"]["pdf"]["layout"]
        elif failure == "degraded":
            layout["quality"]["status"] = "degraded"
        elif failure == "bbox":
            layout["blocks"][0]["bbox"] = [0.5, 0, 0.4, 0.1]
        elif failure == "order":
            layout["blocks"][1]["source_order"] = layout["blocks"][0]["source_order"]
        elif failure == "order_gap":
            layout["blocks"][1]["source_order"] = 2
            layout["blocks"][2]["source_order"] = 3
        elif failure == "page_out_of_range":
            layout["blocks"][1]["source_page"] = 3
        elif failure == "page_rollback":
            layout["blocks"][1]["source_page"] = 2
            layout["blocks"][2]["source_page"] = 1
        elif failure == "reference":
            layout["blocks"][1]["continuation_of"] = "unknown-block"
            layout["blocks"][1]["join_with"] = ""
        elif failure == "continuation_gap":
            layout["blocks"].append(
                layout_block(
                    3,
                    "paragraph",
                    "续行",
                    continuation_of="line-0",
                    join_with="",
                )
            )
            layout["quality"]["source_line_count"] += 1
            layout["quality"]["output_block_count"] += 1
        elif failure == "continuation_role":
            layout["blocks"][2]["continuation_of"] = "line-1"
        elif failure == "heading_continuation":
            layout["blocks"][1]["continuation_of"] = "line-0"
        elif failure == "continuation_distance":
            layout["blocks"][1]["role"] = "paragraph"
            layout["blocks"][1]["heading_level"] = None
            layout["quality"]["heading_count"] -= 1
            layout["blocks"][2]["continuation_of"] = "line-1"
            layout["blocks"][2]["bbox"] = [0, 0.8, 0.5, 0.805]
        elif failure == "visual_order":
            layout["blocks"][1]["bbox"] = [0, 0.8, 0.5, 0.805]
            layout["blocks"][2]["bbox"] = [0, 0.2, 0.5, 0.205]
        elif failure == "row_reverse":
            layout["blocks"][1]["role"] = "paragraph"
            layout["blocks"][1]["heading_level"] = None
            layout["quality"]["heading_count"] -= 1
            layout["blocks"][1]["row_id"] = "row-1"
            layout["blocks"][1]["bbox"] = [0.6, 0.1, 0.9, 0.105]
            layout["blocks"][2]["row_id"] = "row-1"
            layout["blocks"][2]["bbox"] = [0.1, 0.1, 0.4, 0.105]
            layout["quality"]["row_group_count"] = 1
        elif failure == "row_overlap":
            layout["blocks"][1]["role"] = "paragraph"
            layout["blocks"][1]["heading_level"] = None
            layout["quality"]["heading_count"] -= 1
            layout["blocks"][1]["row_id"] = "row-1"
            layout["blocks"][1]["bbox"] = [0, 0.1, 0.6, 0.105]
            layout["blocks"][2]["row_id"] = "row-1"
            layout["blocks"][2]["bbox"] = [0.5, 0.1, 0.9, 0.105]
            layout["quality"]["row_group_count"] = 1
        elif failure == "row_barely_vertical":
            layout["blocks"][1]["role"] = "paragraph"
            layout["blocks"][1]["heading_level"] = None
            layout["quality"]["heading_count"] -= 1
            layout["blocks"][1]["row_id"] = "row-1"
            layout["blocks"][1]["bbox"] = [0, 0.1, 0.4, 0.2]
            layout["blocks"][2]["row_id"] = "row-1"
            layout["blocks"][2]["bbox"] = [0.5, 0.19, 0.9, 0.29]
            layout["quality"]["row_group_count"] = 1
        elif failure == "layout_extra":
            layout["unexpected"] = True
        elif failure == "block_extra":
            layout["blocks"][0]["unexpected"] = True
        elif failure == "quality_extra":
            layout["quality"]["unexpected"] = True
        elif failure == "count":
            layout["quality"]["output_block_count"] += 1
        elif failure == "markdown":
            payload["outputs"]["markdown"] = payload["outputs"]["markdown"].replace(
                "可靠的简历正文", "被篡改的正文", 1
            )
        elif failure == "warning":
            layout["quality"]["warnings"] = ["unknown_layout_warning"]
        return httpx.Response(
            200,
            headers={"X-Request-ID": request_id},
            json=payload,
        )

    with pytest.raises(DocumentConversionFailure) as raised:
        run_parse(client(handler))
    assert raised.value.status_code == 422
    assert raised.value.code == "RESUME_LAYOUT_UNSUPPORTED"
