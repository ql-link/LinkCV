from __future__ import annotations

import base64
import json
import math
from datetime import datetime
from typing import Any

import httpx


class LokiUnavailableError(RuntimeError):
    pass


class InvalidLogCursorError(ValueError):
    pass


def _quoted(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _selector(labels: dict[str, str]) -> str:
    parts = [f"{key}={_quoted(value)}" for key, value in sorted(labels.items())]
    return "{" + ",".join(parts) + "}"


def encode_cursor(before_ns: int) -> str:
    payload = json.dumps({"beforeNs": str(before_ns)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii").rstrip("=")


def decode_cursor(value: str) -> int:
    try:
        padding = "=" * (-len(value) % 4)
        payload = json.loads(base64.urlsafe_b64decode(value + padding))
        before_ns = payload["beforeNs"]
        if not isinstance(before_ns, str) or not before_ns.isdecimal():
            raise ValueError
        parsed = int(before_ns)
        if parsed < 1:
            raise ValueError
        return parsed
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise InvalidLogCursorError("invalid log cursor") from error


class LokiClient:
    def __init__(self, base_url: str, timeout_seconds: float) -> None:
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=timeout_seconds,
        )

    def close(self) -> None:
        self._client.close()

    def _get(self, path: str, params: dict[str, object]) -> dict[str, Any]:
        try:
            response = self._client.get(path, params=params)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise LokiUnavailableError("Loki query failed") from error
        if not isinstance(payload, dict) or payload.get("status") != "success":
            raise LokiUnavailableError("Loki returned an invalid response")
        data = payload.get("data")
        if not isinstance(data, dict):
            raise LokiUnavailableError("Loki response data is invalid")
        return data

    @staticmethod
    def _query(
        *,
        environment: str,
        log_type: str,
        filters: dict[str, str],
        keyword: str | None,
    ) -> str:
        labels = {
            "environment": environment,
            "log_type": log_type,
            "service": "linkcv",
        }
        level = filters.pop("level", None)
        if level:
            labels["level"] = level
        query = _selector(labels) + " | json"
        for key, value in filters.items():
            query += f" | {key}={_quoted(value)}"
        if keyword:
            query += f" |= {_quoted(keyword)}"
        return query

    def query_logs(
        self,
        *,
        environment: str,
        log_type: str,
        start_ns: int,
        end_ns: int,
        filters: dict[str, str],
        keyword: str | None,
        cursor: str | None,
        limit: int,
    ) -> dict[str, object]:
        if cursor:
            end_ns = min(end_ns, decode_cursor(cursor) - 1)
        if end_ns < start_ns:
            return {
                "items": [],
                "next_cursor": None,
                "partial": False,
                "dropped_malformed": 0,
            }
        query = self._query(
            environment=environment,
            log_type=log_type,
            filters=dict(filters),
            keyword=keyword,
        )
        data = self._get(
            "/loki/api/v1/query_range",
            {
                "query": query,
                "start": str(start_ns),
                "end": str(end_ns),
                "direction": "backward",
                "limit": min(1000, max(limit + 1, limit * 4)),
            },
        )
        result = data.get("result")
        if not isinstance(result, list):
            raise LokiUnavailableError("Loki streams are invalid")

        by_event_id: dict[str, dict[str, object]] = {}
        dropped = 0
        for stream in result:
            if not isinstance(stream, dict) or not isinstance(stream.get("values"), list):
                dropped += 1
                continue
            for value in stream["values"]:
                try:
                    loki_timestamp, raw = value
                    event = json.loads(raw)
                    event_id = event["event_id"]
                    timestamp_ns = int(event.get("timestamp_ns", loki_timestamp))
                    if (
                        not isinstance(event, dict)
                        or not isinstance(event_id, str)
                        or event.get("log_type") != log_type
                        or timestamp_ns < start_ns
                        or timestamp_ns > end_ns
                    ):
                        raise ValueError
                    event["timestamp_ns"] = str(timestamp_ns)
                    by_event_id[event_id] = event
                except (ValueError, TypeError, KeyError, json.JSONDecodeError):
                    dropped += 1
        items = sorted(
            by_event_id.values(),
            key=lambda item: (int(str(item["timestamp_ns"])), str(item["event_id"])),
            reverse=True,
        )
        has_more = len(items) > limit
        page = items[:limit]
        next_cursor = (
            encode_cursor(int(str(page[-1]["timestamp_ns"])))
            if has_more and page
            else None
        )
        return {
            "items": page,
            "next_cursor": next_cursor,
            "partial": dropped > 0,
            "dropped_malformed": dropped,
        }

    def _metric(
        self,
        *,
        query: str,
        at_ns: int,
        group_label: str,
    ) -> dict[str, int]:
        data = self._get(
            "/loki/api/v1/query",
            {"query": query, "time": str(at_ns)},
        )
        result = data.get("result")
        if not isinstance(result, list):
            raise LokiUnavailableError("Loki metric result is invalid")
        counts: dict[str, int] = {}
        for item in result:
            try:
                metric = item["metric"]
                value = item["value"][1]
                name = metric[group_label]
                counts[str(name)] = int(float(value))
            except (KeyError, IndexError, TypeError, ValueError):
                raise LokiUnavailableError("Loki metric item is invalid")
        return counts

    def query_summary(
        self,
        *,
        environment: str,
        start: datetime,
        end: datetime,
    ) -> dict[str, dict[str, int]]:
        seconds = max(1, math.ceil((end - start).total_seconds()))
        end_ns = int(end.timestamp() * 1_000_000_000) - 1
        system_selector = _selector(
            {
                "environment": environment,
                "log_type": "system",
                "service": "linkcv",
            }
        )
        audit_selector = _selector(
            {
                "environment": environment,
                "log_type": "audit",
                "service": "linkcv",
            }
        )
        system = self._metric(
            query=f"sum by (level) (count_over_time({system_selector}[{seconds}s]))",
            at_ns=end_ns,
            group_label="level",
        )
        audit = self._metric(
            query=(
                "sum by (result) (count_over_time("
                f"{audit_selector} | json [{seconds}s]))"
            ),
            at_ns=end_ns,
            group_label="result",
        )
        return {
            "system": {
                "total": sum(system.values()),
                "warnings": system.get("WARNING", 0),
                "errors": system.get("ERROR", 0) + system.get("CRITICAL", 0),
            },
            "audit": {
                "total": sum(audit.values()),
                "succeeded": audit.get("succeeded", 0),
                "failed": audit.get("failed", 0),
            },
        }
