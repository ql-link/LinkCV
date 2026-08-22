import json
import os
import time

from linkcv.modules.observability.logging import JsonlFileWriter, StructuredLogEmitter


def test_structured_emitter_redacts_secrets_and_preserves_query_fields(capsys) -> None:
    emitter = StructuredLogEmitter(environment="test")

    recorded, event = emitter.emit(
        log_type="system",
        level="ERROR",
        logger="tests.observability",
        message=(
            "request https://example.test/path?token=raw "
            "Bearer abc.def.ghi user@example.test password=hunter2 "
            "{\"api_key\":\"json-secret\", 'cookie': 'dict-secret'}"
        ),
        source="web",
        request_id="request_123",
        dependency="linkparse",
        duration_ms=12,
        source_format="docx",
        word_meta={"omitted_image_count": 1, "table_failure_count": 2},
        failure_stage="resume_normalization",
        stage="resume_normalization",
        validation_model="ResumeLink",
        validation_paths="url",
        validation_types="value_error",
        warning_count=2,
        unsupported_field="must-not-be-recorded",
    )

    assert recorded is True
    assert event["service"] == "linkcv"
    assert event["environment"] == "test"
    assert event["source"] == "web"
    assert event["request_id"] == "request_123"
    assert event["duration_ms"] == 12
    assert event["source_format"] == "docx"
    assert "omitted_image_count" in event["word_meta"]
    assert "table_failure_count" in event["word_meta"]
    assert event["failure_stage"] == "resume_normalization"
    assert event["stage"] == "resume_normalization"
    assert event["validation_model"] == "ResumeLink"
    assert event["validation_paths"] == "url"
    assert event["validation_types"] == "value_error"
    assert event["warning_count"] == 2
    assert "unsupported_field" not in event
    serialized = json.dumps(event)
    assert "raw" not in serialized
    assert "hunter2" not in serialized
    assert "user@example.test" not in serialized
    assert "abc.def.ghi" not in serialized
    assert "json-secret" not in serialized
    assert "dict-secret" not in serialized
    assert "[REDACTED]" in serialized
    assert json.loads(capsys.readouterr().err)["event_id"] == event["event_id"]


def test_audit_event_uses_failure_level_and_returns_event_id(capsys) -> None:
    emitter = StructuredLogEmitter(environment="test")

    recorded, event_id = emitter.audit(
        action="resume.update",
        actor_user_id=42,
        actor_type="user",
        target_type="resume",
        target_id="9",
        result="failed",
        error_code="RESUME_EDIT_CONFLICT",
    )

    assert recorded is True
    event = json.loads(capsys.readouterr().err)
    assert event_id == event["event_id"]
    assert event["log_type"] == "audit"
    assert event["level"] == "WARNING"
    assert event["actor_user_id"] == "42"
    assert event["result"] == "failed"


def test_file_writer_removes_rotated_files_older_than_seven_days(tmp_path) -> None:
    active = tmp_path / "linkcv.jsonl"
    active.write_text("{}\n", encoding="utf-8")
    old = time.time() - 8 * 24 * 60 * 60
    os.utime(active, (old, old))

    writer = JsonlFileWriter(tmp_path, retention_days=7)
    writer.write("{\"event_id\":\"new\"}")

    assert active.read_text(encoding="utf-8") == '{"event_id":"new"}\n'
    assert list(tmp_path.glob("linkcv.*.jsonl")) == []
