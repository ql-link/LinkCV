from __future__ import annotations

import json
import logging
import os
import re
import sys
import threading
import time
import traceback
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import TracebackType
from uuid import uuid4

from linkcv.core.config import Settings
from linkcv.modules.observability.context import current_context

MESSAGE_LIMIT = 2048
STACK_LIMIT = 8192
FIELD_LIMIT = 512
LOG_FILE_NAME = "linkcv.jsonl"

_EMAIL_PATTERN = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
_BEARER_PATTERN = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")
_JWT_PATTERN = re.compile(
    r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"
)
_SECRET_ASSIGNMENT_PATTERN = re.compile(
    r"(?i)([\"']?(?:password|token|cookie|secret|api[_-]?key)[\"']?"
    r"\s*[:=]\s*)[\"']?[^\s,;}]+"
)
_URL_QUERY_PATTERN = re.compile(r"(https?://[^\s?#]+)[?#][^\s]+")

ALLOWED_FIELDS = {
    "actor_user_id",
    "action",
    "dependency",
    "duration_ms",
    "error_code",
    "failure_stage",
    "http_method",
    "http_route",
    "http_status",
    "operation_id",
    "request_id",
    "result",
    "source",
    "source_format",
    "stage",
    "summary",
    "target_id",
    "target_type",
    "task_id",
    "attempt",
    "actor_type",
    "exception_type",
    "exception_stack",
    "word_meta",
    "validation_model",
    "validation_paths",
    "validation_types",
    "warning_count",
}


def redact_text(value: object, limit: int = FIELD_LIMIT) -> str:
    text = str(value).replace("\r", "\\r").replace("\n", "\\n")
    text = _URL_QUERY_PATTERN.sub(r"\1?[REDACTED]", text)
    text = _BEARER_PATTERN.sub("Bearer [REDACTED]", text)
    text = _JWT_PATTERN.sub("[REDACTED_TOKEN]", text)
    text = _EMAIL_PATTERN.sub("[REDACTED_EMAIL]", text)
    text = _SECRET_ASSIGNMENT_PATTERN.sub(r"\1[REDACTED]", text)
    return text[:limit]


def emergency_log(message: str) -> None:
    safe = redact_text(message, MESSAGE_LIMIT)
    try:
        os.write(2, f"linkcv-observability-error: {safe}\n".encode("utf-8"))
    except OSError:
        pass


class JsonlFileWriter:
    def __init__(self, directory: Path, retention_days: int) -> None:
        self.directory = directory
        self.retention_days = retention_days
        self.path = directory / LOG_FILE_NAME
        self._lock = threading.RLock()
        directory.mkdir(parents=True, exist_ok=True)
        self._rotate_if_needed()
        self._cleanup()

    def _rotate_if_needed(self) -> None:
        if not self.path.exists() or self.path.stat().st_size == 0:
            return
        modified = datetime.fromtimestamp(self.path.stat().st_mtime, UTC).date()
        today = datetime.now(UTC).date()
        if modified >= today:
            return
        suffix = datetime.fromtimestamp(self.path.stat().st_mtime, UTC).strftime(
            "%Y-%m-%d"
        )
        destination = self.directory / f"linkcv.{suffix}.{uuid4().hex[:8]}.jsonl"
        self.path.replace(destination)
        self._cleanup()

    def _cleanup(self) -> None:
        cutoff = datetime.now(UTC) - timedelta(days=self.retention_days)
        for path in self.directory.glob("linkcv.*.jsonl"):
            try:
                if datetime.fromtimestamp(path.stat().st_mtime, UTC) < cutoff:
                    path.unlink()
            except OSError as error:
                emergency_log(f"failed to clean old log file: {type(error).__name__}")

    def write(self, line: str) -> None:
        with self._lock:
            self._rotate_if_needed()
            with self.path.open("a", encoding="utf-8") as stream:
                stream.write(line)
                stream.write("\n")
                stream.flush()


class StructuredLogEmitter:
    def __init__(
        self,
        *,
        environment: str,
        service: str = "linkcv",
        directory: Path | None = None,
        retention_days: int = 7,
    ) -> None:
        self.environment = environment
        self.service = service
        self.writer = (
            JsonlFileWriter(directory, retention_days) if directory is not None else None
        )
        self._clock_lock = threading.Lock()
        self._last_timestamp_ns = 0
        self._output_lock = threading.Lock()

    def _timestamp_ns(self) -> int:
        with self._clock_lock:
            value = time.time_ns()
            if value <= self._last_timestamp_ns:
                value = self._last_timestamp_ns + 1
            self._last_timestamp_ns = value
            return value

    def _event(
        self,
        *,
        log_type: str,
        level: str,
        logger: str,
        message: str,
        fields: dict[str, object],
    ) -> dict[str, object]:
        timestamp_ns = self._timestamp_ns()
        event: dict[str, object] = {
            "timestamp_ns": str(timestamp_ns),
            "timestamp": datetime.fromtimestamp(
                timestamp_ns / 1_000_000_000, UTC
            ).isoformat().replace("+00:00", "Z"),
            "event_id": uuid4().hex,
            "event_version": 1,
            "log_type": log_type,
            "level": level,
            "service": self.service,
            "environment": self.environment,
            "source": "backend",
            "logger": redact_text(logger, 256),
            "message": redact_text(message, MESSAGE_LIMIT),
        }
        event.update(current_context())
        for key, value in fields.items():
            if key not in ALLOWED_FIELDS or value is None:
                continue
            if key in {"attempt", "duration_ms", "http_status", "warning_count"}:
                event[key] = max(0, int(value))
            elif key == "actor_user_id":
                candidate = str(value)
                if candidate.isdecimal():
                    event[key] = candidate
            elif key == "exception_stack":
                event[key] = redact_text(value, STACK_LIMIT)
            else:
                event[key] = redact_text(value)
        return event

    def emit(
        self,
        *,
        log_type: str,
        level: str,
        logger: str,
        message: str,
        **fields: object,
    ) -> tuple[bool, dict[str, object]]:
        event = self._event(
            log_type=log_type,
            level=level,
            logger=logger,
            message=message,
            fields=fields,
        )
        line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
        with self._output_lock:
            try:
                sys.stderr.write(line + "\n")
                sys.stderr.flush()
            except (OSError, ValueError):
                pass
        if self.writer is None:
            return True, event
        try:
            self.writer.write(line)
        except OSError as error:
            emergency_log(f"local log write failed: {type(error).__name__}")
            return False, event
        return True, event

    def system(
        self,
        level: str,
        message: str,
        *,
        logger: str = "linkcv.system",
        **fields: object,
    ) -> bool:
        recorded, _ = self.emit(
            log_type="system",
            level=level,
            logger=logger,
            message=message,
            **fields,
        )
        return recorded

    def audit(self, **fields: object) -> tuple[bool, str]:
        recorded, event = self.emit(
            log_type="audit",
            level="INFO" if fields.get("result") == "succeeded" else "WARNING",
            logger="linkcv.audit",
            message="business action completed",
            **fields,
        )
        return recorded, str(event["event_id"])


class StructuredLoggingHandler(logging.Handler):
    def __init__(self, emitter: StructuredLogEmitter) -> None:
        super().__init__()
        self.emitter = emitter
        self._linkcv_structured = True

    def emit(self, record: logging.LogRecord) -> None:
        fields: dict[str, object] = {}
        for key in ALLOWED_FIELDS:
            if hasattr(record, key):
                fields[key] = getattr(record, key)
        if hasattr(record, "user_id") and "actor_user_id" not in fields:
            fields["actor_user_id"] = getattr(record, "user_id")
        if hasattr(record, "error_type") and "exception_type" not in fields:
            fields["exception_type"] = getattr(record, "error_type")
        if record.exc_info:
            fields["exception_type"] = record.exc_info[0].__name__
            fields["exception_stack"] = "".join(
                traceback.format_exception(*record.exc_info)
            )
        try:
            message = record.getMessage()
        except Exception:
            message = "log message formatting failed"
        self.emitter.system(
            record.levelname,
            message,
            logger=record.name,
            **fields,
        )


def configure_logging(settings: Settings) -> StructuredLogEmitter:
    emitter = StructuredLogEmitter(
        environment=settings.app_environment,
        service=settings.log_service_name,
        directory=settings.log_directory,
        retention_days=settings.log_retention_days,
    )
    root = logging.getLogger()
    for handler in list(root.handlers):
        if getattr(handler, "_linkcv_structured", False):
            root.removeHandler(handler)
    root.addHandler(StructuredLoggingHandler(emitter))
    root.setLevel(getattr(logging, settings.log_level))
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
    logging.captureWarnings(True)
    return emitter


def exception_fields(
    error_type: type[BaseException],
    error: BaseException,
    trace: TracebackType | None,
) -> dict[str, str]:
    return {
        "exception_type": error_type.__name__,
        "exception_stack": "".join(traceback.format_exception(error_type, error, trace)),
    }


def dependency_for_exception(error: BaseException) -> str | None:
    """Classify known infrastructure failures without importing optional clients."""

    current: BaseException | None = error
    visited: set[int] = set()
    while current is not None and id(current) not in visited:
        visited.add(id(current))
        module = type(current).__module__.lower()
        name = type(current).__name__.lower()
        if module.startswith("sqlalchemy") or "database" in name:
            return "mysql"
        if module.startswith("redis"):
            return "redis"
        if module.startswith("minio") or name == "s3error":
            return "minio"
        current = current.__cause__ or current.__context__
    return None
