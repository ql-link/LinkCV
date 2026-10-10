from __future__ import annotations

import hashlib
import json
import math
import unicodedata


def _validate_scalar_tree(value: object, path: str = "$") -> None:
    if isinstance(value, str):
        if value != unicodedata.normalize("NFC", value):
            raise ValueError(f"non-NFC string at {path}")
        if any(
            unicodedata.category(character) == "Cc" and character not in "\n\t"
            for character in value
        ):
            raise ValueError(f"control character at {path}")
        return
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"non-finite number at {path}")
    if isinstance(value, list):
        for index, item in enumerate(value):
            _validate_scalar_tree(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError(f"non-string object key at {path}")
            _validate_scalar_tree(key, f"{path}.<key>")
            _validate_scalar_tree(item, f"{path}.{key}")


def canonical_json_bytes(value: object) -> bytes:
    """Return the backend-owned v1 JSON representation used by resume hashes.

    Callers hash validated Python contract models. Frontend consumers must treat
    the resulting digest as opaque and never reproduce this algorithm.
    """

    _validate_scalar_tree(value)
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def canonical_sha256(value: object) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()
