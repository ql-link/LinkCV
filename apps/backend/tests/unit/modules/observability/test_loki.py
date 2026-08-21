from datetime import UTC, datetime, timedelta
import json

import httpx
import pytest

from linkcv.modules.observability.loki import (
    InvalidLogCursorError,
    LokiClient,
    decode_cursor,
    encode_cursor,
)


def _event(event_id: str, timestamp_ns: int, **fields: object) -> str:
    return json.dumps(
        {
            "timestamp_ns": str(timestamp_ns),
            "timestamp": "2026-08-07T00:00:00Z",
            "event_id": event_id,
            "event_version": 1,
            "log_type": "system",
            "level": "ERROR",
            "service": "linkcv",
            "environment": "test",
            "source": "backend",
            "logger": "linkcv.http",
            "message": "failed",
            **fields,
        }
    )


def test_query_logs_uses_fixed_selector_deduplicates_and_marks_malformed() -> None:
    seen_query = ""

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal seen_query
        seen_query = request.url.params["query"]
        payload = {
            "status": "success",
            "data": {
                "result": [
                    {
                        "values": [
                            ["30", _event("three", 30)],
                            ["20", _event("two", 20)],
                            ["20", _event("two", 20)],
                            ["10", "not-json"],
                        ]
                    }
                ]
            },
        }
        return httpx.Response(200, json=payload)

    client = LokiClient("http://loki.test", 1)
    client._client.close()
    client._client = httpx.Client(
        base_url="http://loki.test", transport=httpx.MockTransport(handler)
    )
    result = client.query_logs(
        environment="test",
        log_type="system",
        start_ns=1,
        end_ns=100,
        filters={"level": "ERROR", "request_id": 'x" |~ ".*'},
        keyword='secret" |= "everything',
        cursor=None,
        limit=1,
    )
    client.close()

    assert [item["event_id"] for item in result["items"]] == ["three"]
    assert result["partial"] is True
    assert result["dropped_malformed"] == 1
    assert result["next_cursor"] is not None
    assert decode_cursor(str(result["next_cursor"])) == 30
    assert 'service="linkcv"' in seen_query
    assert 'log_type="system"' in seen_query
    assert 'request_id="x\\\" |~ \\".*"' in seen_query


def test_cursor_rejects_invalid_payload() -> None:
    assert decode_cursor(encode_cursor(123)) == 123
    with pytest.raises(InvalidLogCursorError):
        decode_cursor("not-a-cursor")


def test_summary_groups_system_and_audit_counts() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        query = request.url.params["query"]
        result = (
            [
                {"metric": {"result": "succeeded"}, "value": [0, "4"]},
                {"metric": {"result": "failed"}, "value": [0, "2"]},
            ]
            if 'log_type="audit"' in query
            else [
                {"metric": {"level": "INFO"}, "value": [0, "7"]},
                {"metric": {"level": "ERROR"}, "value": [0, "3"]},
            ]
        )
        return httpx.Response(
            200, json={"status": "success", "data": {"result": result}}
        )

    client = LokiClient("http://loki.test", 1)
    client._client.close()
    client._client = httpx.Client(
        base_url="http://loki.test", transport=httpx.MockTransport(handler)
    )
    end = datetime(2026, 8, 7, tzinfo=UTC)
    summary = client.query_summary(
        environment="test", start=end - timedelta(hours=1), end=end
    )
    client.close()

    assert summary == {
        "system": {"total": 10, "warnings": 0, "errors": 3},
        "audit": {"total": 6, "succeeded": 4, "failed": 2},
    }
