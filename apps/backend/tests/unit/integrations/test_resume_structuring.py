import asyncio
import json

import pytest

from linkcv.domain.document_conversion import PdfLayoutBlock
from linkcv.domain.resume import (
    ParsedSourceBlock,
    build_source_graph,
    validate_sparse_annotations,
)
from linkcv.integrations.resume_structuring import (
    LLMResumeStructuringClient,
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


def sparse_payload(
    graph,
    annotations=None,
    *,
    source_graph_sha256: str | None = None,
) -> str:
    return json.dumps({
        "schema_version": "sparse-resume-annotations.v1",
        "source_graph_sha256": source_graph_sha256 or graph.graph_sha256(),
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


def valid_identity_annotation(graph):
    return {
        "source_id": graph.leaves[0].source_id,
        "role": "identity_name",
        "semantic_kind": None,
        "entry_anchor_source_id": None,
        "field_key": None,
        "normalized_value": None,
        "confidence": 0.9,
    }


def assert_empty_annotations(result, graph) -> None:
    assert result.schema_version == "sparse-resume-annotations.v1"
    assert result.source_graph_sha256 == graph.graph_sha256()
    assert result.annotations == []
    validate_sparse_annotations(graph, result)


class TimeoutLLMService:
    def __init__(self) -> None:
        self.calls = []

    async def structured_chat(self, user_id, messages, *, source, response_model, capability):
        self.calls.append((user_id, messages, source, response_model, capability))
        raise TimeoutError("provider timeout")


class SequenceLLMService:
    def __init__(self, outcomes) -> None:
        self.outcomes = outcomes
        self.calls = []

    async def structured_chat(self, user_id, messages, *, source, response_model, capability):
        self.calls.append((user_id, messages, source, response_model, capability))
        outcome = self.outcomes[min(len(self.calls) - 1, len(self.outcomes) - 1)]
        if isinstance(outcome, BaseException):
            raise outcome
        return StructuredChatResult(
            value=response_model.model_validate_json(outcome),
            call_id="llmcall_fixture",
        )


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


def test_sparse_structuring_keeps_valid_annotations() -> None:
    graph = graph_fixture()
    annotation = valid_identity_annotation(graph)
    result = asyncio.run(
        LLMResumeStructuringClient(
            FakeLLMService([sparse_payload(graph, [annotation])])
        ).extract_sparse(
            user_id=42,
            source_graph=graph,
            timeout_seconds=5,
        )
    )

    assert [item.model_dump(mode="json") for item in result.annotations] == [
        annotation
    ]


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
    service = FakeLLMService(
        [unknown, sparse_payload(graph, [valid_identity_annotation(graph)])]
    )
    result = asyncio.run(LLMResumeStructuringClient(service).extract_sparse(
        user_id=42,
        source_graph=graph,
        timeout_seconds=5,
        layout_hints=layout_hints(),
    ))
    assert [annotation.role for annotation in result.annotations] == [
        "identity_name"
    ]
    assert len(service.calls) == 2
    assert "layout" in json.loads(service.calls[0][1][1].content)
    assert "layout" not in json.loads(service.calls[1][1][1].content)


@pytest.mark.parametrize(
    ("second_outcome", "reason"),
    [
        (
            LLMError("LLM_PROVIDER_ERROR", "llmcall_fallback"),
            "model_call_failed",
        ),
        (
            LLMError("LLM_RESPONSE_INVALID", "llmcall_fallback"),
            "llm_response_invalid",
        ),
        (TimeoutError("provider timeout"), "timeout"),
        ("invalid", "invalid_annotations"),
    ],
)
def test_sparse_structuring_falls_back_when_layout_retry_fails(
    second_outcome,
    reason,
    caplog,
) -> None:
    graph = graph_fixture()
    invalid = sparse_payload(graph, [
        {**valid_identity_annotation(graph), "source_id": "src_ffffffffffffffff"}
    ])
    if second_outcome == "invalid":
        second_outcome = invalid
    service = SequenceLLMService([invalid, second_outcome])

    with caplog.at_level("WARNING"):
        result = asyncio.run(LLMResumeStructuringClient(service).extract_sparse(
            user_id=42,
            source_graph=graph,
            timeout_seconds=5,
            layout_hints=layout_hints(),
        ))

    assert_empty_annotations(result, graph)
    assert len(service.calls) == 2
    assert "layout" not in json.loads(service.calls[1][1][1].content)
    assert len(caplog.records) == 1
    assert caplog.records[0].reason == reason


@pytest.mark.parametrize(
    ("annotations", "source_graph_sha256"),
    [
        (
            [{
                **valid_identity_annotation(graph_fixture()),
                "source_id": "src_ffffffffffffffff",
            }],
            None,
        ),
        (
            [{
                **valid_identity_annotation(graph_fixture()),
                "entry_anchor_source_id": "src_eeeeeeeeeeeeeeee",
            }],
            None,
        ),
        (
            [
                valid_identity_annotation(graph_fixture()),
                valid_identity_annotation(graph_fixture()),
            ],
            None,
        ),
        ([], "b" * 64),
    ],
)
def test_sparse_structuring_falls_back_for_invalid_annotation_contract(
    annotations,
    source_graph_sha256,
    caplog,
) -> None:
    graph = graph_fixture()
    with caplog.at_level("WARNING"):
        result = asyncio.run(
            LLMResumeStructuringClient(
                FakeLLMService([
                    sparse_payload(
                        graph,
                        annotations,
                        source_graph_sha256=source_graph_sha256,
                    )
                ])
            ).extract_sparse(
                user_id=42,
                source_graph=graph,
                timeout_seconds=5,
            )
        )

    assert_empty_annotations(result, graph)
    assert len(caplog.records) == 1
    assert caplog.records[0].reason == "invalid_annotations"


@pytest.mark.parametrize(
    "error_code",
    [
        "LLM_CHAT_NOT_CONFIGURED",
        "LLM_MODEL_NOT_CONFIGURED",
        "LLM_CREDENTIALS_UNAVAILABLE",
        "LLM_RESPONSE_INVALID",
        "LLM_PROVIDER_ERROR",
    ],
)
def test_sparse_structuring_falls_back_for_llm_errors(error_code, caplog) -> None:
    graph = graph_fixture()
    client = LLMResumeStructuringClient(
        FakeLLMService([], error_code=error_code)
    )
    with caplog.at_level("WARNING"):
        result = asyncio.run(client.extract_sparse(
            user_id=42, source_graph=graph, timeout_seconds=5,
        ))

    assert_empty_annotations(result, graph)
    assert len(caplog.records) == 1
    assert caplog.records[0].exception_type == "LLMError"
    assert "张三" not in caplog.text
    assert "42" not in caplog.text


def test_sparse_structuring_falls_back_for_timeout(caplog) -> None:
    graph = graph_fixture()
    service = TimeoutLLMService()

    with caplog.at_level("WARNING"):
        result = asyncio.run(LLMResumeStructuringClient(service).extract_sparse(
            user_id=42, source_graph=graph, timeout_seconds=5,
        ))

    assert_empty_annotations(result, graph)
    assert len(service.calls) == 1
    assert len(caplog.records) == 1
    assert caplog.records[0].reason == "timeout"
    assert caplog.records[0].exception_type == "TimeoutError"
    assert "provider timeout" not in caplog.text
