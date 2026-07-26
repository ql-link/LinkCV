import asyncio
import json

import httpx
import pytest

from linkcv.domain.section_ir import build_section_ir
from linkcv.integrations.llm_client import HttpStructuredLlmClient, StructuringModelError
from linkcv.integrations.rag_client import HttpRagClient


def test_http_rag_client_maps_tolink_response_to_internal_contract() -> None:
    async def run() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/convert"
            assert request.headers["Authorization"] == "Bearer rag-secret"
            assert b"resume.pdf" in request.content
            return httpx.Response(
                200,
                json={
                    "markdown": "# 张三",
                    "page_count": 2,
                    "warnings": ["table_flattened"],
                    "converter_version": "tolink-rag/2",
                },
            )

        client = HttpRagClient(
            base_url="https://rag.example.test",
            api_key="rag-secret",
            convert_path="/convert",
            timeout_seconds=5,
            transport=httpx.MockTransport(handler),
        )
        result = await client.convert(
            filename="resume.pdf",
            content_type="application/pdf",
            content=b"%PDF-fixture",
        )
        assert result.markdown == "# 张三"
        assert result.metadata.page_count == 2
        assert result.metadata.converter_version == "tolink-rag/2"

    asyncio.run(run())


def test_structuring_client_sends_section_ir_and_validates_draft() -> None:
    async def run() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content)
            assert payload["model"] == "fixture-model"
            assert payload["response_format"]["type"] == "json_schema"
            assert "document" in payload["messages"][1]["content"]
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "basics": {
                                            "name": "张三",
                                            "headline": "后端工程师",
                                        }
                                    },
                                    ensure_ascii=False,
                                )
                            }
                        }
                    ]
                },
            )

        client = HttpStructuredLlmClient(
            base_url="https://llm.example.test",
            api_key="llm-secret",
            model="fixture-model",
            structured_path="/chat/completions",
            timeout_seconds=5,
            max_retries=0,
            transport=httpx.MockTransport(handler),
        )
        draft = await client.extract(build_section_ir("# 张三"))
        assert draft.basics.name == "张三"
        assert draft.basics.headline == "后端工程师"

    asyncio.run(run())


def test_structuring_client_does_not_retry_non_retryable_4xx() -> None:
    async def run() -> None:
        attempts = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            return httpx.Response(401, json={"error": "invalid key"})

        client = HttpStructuredLlmClient(
            base_url="https://llm.example.test",
            api_key="invalid",
            model="fixture-model",
            structured_path="/chat/completions",
            timeout_seconds=5,
            max_retries=2,
            transport=httpx.MockTransport(handler),
        )
        with pytest.raises(StructuringModelError):
            await client.extract(build_section_ir("# 张三"))
        assert attempts == 1

    asyncio.run(run())


def test_structuring_client_retries_rate_limit_once() -> None:
    async def run() -> None:
        attempts = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return httpx.Response(429, json={"error": "rate limited"})
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {"message": {"content": '{"basics":{"name":"张三"}}'}}
                    ]
                },
            )

        client = HttpStructuredLlmClient(
            base_url="https://llm.example.test",
            api_key="fixture",
            model="fixture-model",
            structured_path="/chat/completions",
            timeout_seconds=5,
            max_retries=1,
            transport=httpx.MockTransport(handler),
        )
        draft = await client.extract(build_section_ir("# 张三"))
        assert draft.basics.name == "张三"
        assert attempts == 2

    asyncio.run(run())
