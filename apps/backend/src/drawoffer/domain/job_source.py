from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from urllib.parse import SplitResult, urlsplit, urlunsplit


class InvalidJobSource(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class NormalizedJobSource:
    site: str
    job_id: str | None
    url: str
    url_hash: bytes


_BOSS_HOSTS = {"zhipin.com", "www.zhipin.com", "m.zhipin.com"}
_BOSS_PATH = re.compile(r"^/job_detail/([A-Za-z0-9_-]{1,128})\.html$")


def normalize_job_source(raw_url: str) -> NormalizedJobSource:
    value = raw_url.strip()
    if not value or len(value) > 2048 or any(
        ord(character) < 32 or ord(character) == 127 for character in value
    ):
        raise InvalidJobSource("source URL is empty, too long, or contains control characters")

    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise InvalidJobSource("source URL cannot be parsed") from error

    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"} or not parsed.hostname:
        raise InvalidJobSource("source URL must use HTTP or HTTPS")
    if parsed.username is not None or parsed.password is not None:
        raise InvalidJobSource("source URL credentials are not allowed")

    try:
        host = parsed.hostname.encode("idna").decode("ascii").lower()
    except UnicodeError as error:
        raise InvalidJobSource("source hostname is invalid") from error

    path = parsed.path or "/"
    if host in _BOSS_HOSTS:
        match = _BOSS_PATH.fullmatch(path)
        if match is None:
            raise InvalidJobSource("BOSS source URL is not a job detail URL")
        canonical = urlunsplit(
            SplitResult(
                scheme="https",
                netloc="www.zhipin.com",
                path=f"/job_detail/{match.group(1)}.html",
                query="",
                fragment="",
            )
        )
        return _result(site="boss", job_id=match.group(1), url=canonical)

    default_port = (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    display_host = f"[{host}]" if ":" in host else host
    netloc = display_host if port is None or default_port else f"{display_host}:{port}"
    canonical = urlunsplit(
        SplitResult(
            scheme=scheme,
            netloc=netloc,
            path=path,
            query="",
            fragment="",
        )
    )
    if len(canonical) > 2048:
        raise InvalidJobSource("normalized source URL is too long")
    return _result(site="web", job_id=None, url=canonical)


def _result(*, site: str, job_id: str | None, url: str) -> NormalizedJobSource:
    return NormalizedJobSource(
        site=site,
        job_id=job_id,
        url=url,
        url_hash=hashlib.sha256(url.encode("utf-8")).digest(),
    )
