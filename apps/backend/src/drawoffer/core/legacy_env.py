"""Read DRAWOFFER_* settings with a temporary fallback to the legacy LINKRESUME_* names.

Deployed environments still define the pre-rename variables. A non-empty new name
wins; otherwise the legacy value is used and a one-time deprecation warning is
logged without the value itself.
"""

import logging
import os
from collections.abc import Mapping

NEW_PREFIX = "DRAWOFFER_"
LEGACY_PREFIX = "LINKRESUME_"

_logger = logging.getLogger(__name__)
_warned: set[str] = set()


def legacy_name(name: str) -> str:
    if not name.startswith(NEW_PREFIX):
        raise ValueError(f"{name} is not a {NEW_PREFIX} variable")
    return LEGACY_PREFIX + name.removeprefix(NEW_PREFIX)


def env_value(name: str, environ: Mapping[str, str] | None = None) -> str | None:
    source = os.environ if environ is None else environ
    value = source.get(name)
    if value:
        return value
    legacy = legacy_name(name)
    legacy_value = source.get(legacy)
    if legacy_value:
        if legacy not in _warned:
            _warned.add(legacy)
            _logger.warning("%s is deprecated; rename it to %s", legacy, name)
        return legacy_value
    return value
