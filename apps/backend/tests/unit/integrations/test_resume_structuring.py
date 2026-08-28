import asyncio
import json

import pytest

from linkcv.domain.document_conversion import PdfLayoutBlock
from linkcv.domain.resume import ParsedSourceBlock, build_source_graph
from linkcv.integrations.resume_structuring import (
    LLMResumeStructuringClient,
    ResumeStructureInvalidError,
    structuring_payload,
)
from linkcv.modules.llm.catalog import RESUME_STRUCTURING_CAPABILITY
from linkcv.modules.llm.schemas import StructuredChatResult
from linkcv.modules.llm.service import LLMError


class FakeLLMService:
    def __init__(self, contents: list[str], error_code: str | None = None) -> None:
        self.contents = contents
        self.error_code = error_code
        self.calls = []

    async def structured_chat(self, user_id, messages, *, source, response_model, capability):
        self.calls.append((user_id, messages, source, response_model, capability))
        if self.error_code is not None:
            raise LLMError(self.error_code, "llmcall_fixture")
        content = self.contents[min(len(self.calls) - 1, len(self.contents) - 1)]
        return StructuredChatResult(
            value=response_model.model_validate_json(content),
            call_id="llmcall_fixture",
        )


def graph_fixture():
    return build_source_graph(
        source_document_sha256="a" * 64,
        blocks=[
            ParsedSourceBlock(block_id="name", page=1, leaf_kind="heading", text="张三"),
            ParsedSourceBlock(block_id="body", page=1, leaf_kind="paragraph", text="正文"),
        ],
    )


def sparse_payload(graph, annotations=None) -> str:
    return json.dumps({
        "schema_version": "sparse-resume-annotations.v1",
        "source_graph_sha256": graph.graph_sha256(),
        "annotations": annotations or [],
    }, ensure_ascii=False)


def layout_hints():
    return [PdfLayoutBlock(
        block_id="page-1-line-1",
        source_order=0,
        source_page=1,
        role="heading",
        heading_level=1,
        text="张三",
        bbox=(0.1, 0.1, 0.5, 0.12),
        confidence=0.97,
        role_source="visual_inference",
    )]


def test_sparse_structuring_uses_source_graph_as_the_only_llm_contract() -> None:
    graph = graph_fixture()
    service = FakeLLMService([sparse_payload(graph)])
    result = asyncio.run(LLMResumeStructuringClient(service).extract_sparse(
        user_id=42, source_graph=graph, timeout_seconds=5,
    ))

    assert result.annotations == []
    user_id, messages, source, response_model, capability = service.calls[0]
    payload = json.loads(messages[1].content)
    assert set(payload) == {"source_graph"}
    assert [leaf["source_id"] for leaf in payload["source_graph"]["leaves"]] == [
        leaf.source_id for leaf in graph.leaves
    ]
    assert "可以省略你无法可靠判断的来源" in messages[0].content
    assert user_id == 42
    assert source == "resume_import"
    assert response_model.__name__ == "SparseResumeAnnotations"
    assert capability == RESUME_STRUCTURING_CAPABILITY


def test_structuring_payload_adds_only_bounded_advisory_layout_fields() -> None:
    graph = graph_fixture()
    payload = structuring_payload(source_graph=graph, layout_hints=layout_hints())
    assert set(payload) == {"source_graph", "layout"}
    assert set(payload["layout"][0]) == {
        "block_id", "source_order", "source_page", "text", "bbox",
        "confidence", "role", "row_id", "continuation_of",
    }
    assert "source_id" not in payload["layout"][0]
    assert "role_source" not in payload["layout"][0]


def test_sparse_structuring_retries_without_invalid_layout_influence() -> None:
    graph = graph_fixture()
    unknown = sparse_payload(graph, [{
        "source_id": "src_ffffffffffffffff",
        "role": "body",
        "semantic_kind": "custom",
        "entry_anchor_source_id": None,
        "field_key": None,
        "normalized_value": None,
        "confidence": 0.9,
    }])
    service = FakeLLMService([unknown, sparse_payload(graph)])
    result = asyncio.run(LLMResumeStructuringClient(service).extract_sparse(
        user_id=42,
        source_graph=graph,
        timeout_seconds=5,
        layout_hints=layout_hints(),
    ))
    assert result.annotations == []
    assert len(service.calls) == 2
    assert "layout" in json.loads(service.calls[0][1][1].content)
    assert "layout" not in json.loads(service.calls[1][1][1].content)


def test_sparse_structuring_rejects_unknown_and_duplicate_annotations() -> None:
    graph = graph_fixture()
    source_id = graph.leaves[0].source_id
    annotation = {
        "source_id": source_id,
        "role": "body",
        "semantic_kind": "custom",
        "entry_anchor_source_id": None,
        "field_key": None,
        "normalized_value": None,
        "confidence": 0.9,
    }
    for content in (
        sparse_payload(graph, [{**annotation, "source_id": "src_ffffffffffffffff"}]),
        sparse_payload(graph, [annotation, annotation]),
    ):
        with pytest.raises(ResumeStructureInvalidError):
            asyncio.run(LLMResumeStructuringClient(FakeLLMService([content])).extract_sparse(
                user_id=42, source_graph=graph, timeout_seconds=5,
            ))


def test_sparse_structuring_maps_invalid_model_response_to_stable_error() -> None:
    graph = graph_fixture()
    client = LLMResumeStructuringClient(
        FakeLLMService([], error_code="LLM_RESPONSE_INVALID")
    )
    with pytest.raises(ResumeStructureInvalidError):
        asyncio.run(client.extract_sparse(
            user_id=42, source_graph=graph, timeout_seconds=5,
        ))
