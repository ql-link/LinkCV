from __future__ import annotations

import re
from contextlib import contextmanager
from contextvars import ContextVar, Token
from collections.abc import Iterator

REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_request_id: ContextVar[str | None] = ContextVar("linkcv_request_id", default=None)
_task_id: ContextVar[str | None] = ContextVar("linkcv_task_id", default=None)
_operation_id: ContextVar[str | None] = ContextVar(
    "linkcv_operation_id", default=None
)


def valid_request_id(value: str | None) -> bool:
    return bool(value and REQUEST_ID_PATTERN.fullmatch(value))


def current_context() -> dict[str, str]:
    values = {
        "request_id": _request_id.get(),
        "task_id": _task_id.get(),
        "operation_id": _operation_id.get(),
    }
    return {key: value for key, value in values.items() if value is not None}


def set_request_id(value: str) -> Token[str | None]:
    return _request_id.set(value)


def reset_request_id(token: Token[str | None]) -> None:
    _request_id.reset(token)


@contextmanager
def bind_operation_id(value: str) -> Iterator[None]:
    token = _operation_id.set(value)
    try:
        yield
    finally:
        _operation_id.reset(token)


@contextmanager
def bind_task_id(value: str) -> Iterator[None]:
    token = _task_id.set(value)
    try:
        yield
    finally:
        _task_id.reset(token)
