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
    payload = {
        "request_id": request_id,
        "filename": "resume.pdf",
        "engine": "opendataloader",
        "detected_type": "text_pdf",
        "outputs": {"markdown": "# 张三\n\n## 经历\n" + "可靠的简历正文" * 30},
        "assets": [],
        "meta": {"page_count": 2, "duration_ms": 25},
    }
    payload.update(overrides)
    return payload


def run_parse(instance: LinkParseClient):
    return asyncio.run(
        instance.parse_pdf(
            filename="resume.pdf",
            content=b"%PDF-1.7 fixture",
            operation_id="operation-1",
            deadline_monotonic=monotonic() + 120,
        )
    )


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
    assert b'name="engine"\r\n\r\nauto' in body
    assert b'name="output_formats"\r\n\r\nmarkdown' in body
    assert b'name="ocr"\r\n\r\nauto' in body
    assert b'name="dpi"\r\n\r\n200' in body
    assert b'name="include_bbox"\r\n\r\nfalse' in body
    assert b'name="include_images"\r\n\r\nfalse' in body
    assert result.page_count == 2
    assert result.warnings == ["pdf_ocr_applied"]


@pytest.mark.parametrize(
    ("status", "code", "expected_status", "expected_code"),
    [
        (401, "UNAUTHORIZED", 503, "DOCUMENT_CONVERSION_UNAVAILABLE"),
        (503, "ENGINE_UNAVAILABLE", 503, "DOCUMENT_CONVERSION_UNAVAILABLE"),
        (413, "PDF_TOO_MANY_PAGES", 413, "IMPORT_FILE_TOO_LARGE"),
        (415, "UNSUPPORTED_FILE_TYPE", 415, "UNSUPPORTED_IMPORT_FORMAT"),
        (422, "PDF_RENDER_FAILED", 422, "IMPORT_CONTENT_INVALID"),
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

    instance = client(handler, response_max_bytes=1000 if invalid_kind == "size" else 1_000_000)
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
