from datetime import UTC, datetime

import pytest

from linkcv.core.errors import ApiError
from linkcv.modules.agent.context_service import (
    _ensure_fresh,
    _make_material,
    _snapshot,
)
from linkcv.modules.agent.schemas import AgentContextRef, MessageCreateRequest


def test_context_reference_accepts_web_display_shape_but_keeps_server_marker() -> None:
    ref = AgentContextRef(
        type="resume",
        id="7",
        label="客户端标签不可信",
        updated_at="2026-08-26T00:00:00Z",
        lock_version=3,
    )

    assert ref.version == "3"
    assert ref.label == "客户端标签不可信"
    assert ref.lock_version == 3


def test_message_contexts_limit_and_duplicate_type_are_rejected() -> None:
    base = {"type": "job", "id": "7", "version": "1"}
    with pytest.raises(ValueError):
        MessageCreateRequest(
            content="分析岗位",
            idempotency_key="idempotency-001",
            contexts=[base, {**base, "id": "8"}],
        )
    with pytest.raises(ValueError):
        MessageCreateRequest(
            content="分析资料",
            idempotency_key="idempotency-002",
            contexts=[
                {"type": "resume", "id": str(index), "version": "1"}
                for index in range(1, 12)
            ],
        )


def test_context_snapshot_and_material_do_not_share_body_fields() -> None:
    snapshot = _snapshot(
        type="job",
        id="7",
        version="2",
        lock_version=2,
        label="示例公司 · 后端工程师",
        description="远程",
        updated_at=datetime(2026, 8, 26, tzinfo=UTC),
    )
    material = _make_material(snapshot, {"description": "仅发送给本轮 Pi"})

    assert "content" not in snapshot.model_dump()
    assert material.content["description"] == "仅发送给本轮 Pi"
    assert material.label == snapshot.label


def test_context_stale_marker_is_rejected_without_revealing_owner() -> None:
    ref = AgentContextRef(type="job", id="7", version="1")
    with pytest.raises(ApiError) as caught:
        _ensure_fresh(ref, {"2"})
    assert caught.value.status_code == 409
    assert caught.value.code == "AGENT_CONTEXT_STALE"
