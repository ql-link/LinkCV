#!/usr/bin/env python3
"""Fail when the pre-rename brand (LinkResume / LinkCV) appears outside the allowlist.

The product is DrawOffer. A few legacy names must stay because they identify data,
devices, deployed resources or history that cannot be renamed safely (see
.specs/LOCAL-20261010-DRAWOFFER-RENAME/solution.md, D1–D5 and BR1–BR7).
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(
    os.environ.get("DRAWOFFER_REPO_ROOT")
    or os.environ.get("LINKRESUME_REPO_ROOT")
    or Path(__file__).resolve().parents[2]
).resolve()

LEGACY = re.compile(r"link[_-]?(?:resume|cv)", re.IGNORECASE)
# Lines that explain the legacy name (compat shims, cutover, history) may mention it.
CONTEXT = re.compile(
    r"pre-rename|legacy|旧名|更名|兼容期|old_container|old_image|old_pi_image|runtime_container|port_owners|expected-database"
)

# Files whose legacy names are history and must not be rewritten.
ALLOWED_PATHS = (
    re.compile(r"^third_party/"),
    re.compile(r"^apps/backend/migrations/(versions|sql)/"),  # forward-only history
    re.compile(r"^design-qa\.md$"),  # historical QA log
    re.compile(r"^scripts/quality/check_legacy_brand\.py$"),
)

# Legacy tokens that stay on purpose, grouped by reason.
ALLOWED_TOKENS = [
    # D1: public domain.
    r"[a-z0-9.-]*linkresume\.cn",
    # D2: identifiers persisted inside resume content and chat messages.
    r"linkresume-(?:block|avatar|inline-image(?:-v2)?|image|icon|color|highlight|underline|size|ref)\b",
    r"/linkresume-(?:color|size|underline|highlight)\b",
    r"linkresume\.(?:marks|inline|href|highlight|color|size)\b",
    r"linkresume_(?:inline_\w+|font_size\w*|resume_block_anchor)",
    r"LINKRESUMEICONPLACEHOLDER",
    # D3/D4: Redis keys, browser and mini program storage keys, device identity.
    r"linkresume:[\w:.-]*",
    r"linkresume\.(?:interface-locale|workbench\.page-arrangement|section-focus\.coach\.v1|mock-interviews\.demo\.v3|assistant\.last-session|account-deletion-receipt)",
    r"linkresume-lang\b",
    r"linkresume_(?:access_token|refresh_token|user|privacy_agreement_v1|api_base_url|local_debug_enabled|resume_preview_cache_v\d|resume_pdf_cache_v\d)\b",
    r"__linkresume_demo_resume__",
    r"(?:cn|com)\.linkresume\.[\w.]*",
    r"LinkResume:(?:windows|macos|fixture)",
    r"LinkResume-Dev\b",
    r"/LinkResume\b",
    # D3: stateful deployment resources, Loki labels, OSS paths, plugin objects, Jenkins credentials.
    r"linkresume\.resume_import[\w.]*",
    r"linkresume\.(?:audit|system|web|http)\b",
    r"linkresume[.*]*\.jsonl|linkresume\.\{suffix\}",
    r"linkresume-jsonl",
    r"/var/log/linkresume\b",
    r"linkresume-(?:production|dev|local)-(?:logs|promtail-positions)\b",
    r"linkresume-observability-local\b",
    r"linkresume-dev\b",
    r"linkresume-[\w-]*change-me",
    r"linkresume-root-test|linkresume-test\b",
    r"[\"'`]linkresume[\"'`]",
    r"=linkresume\b|:-linkresume\}|: linkresume\b|//linkresume:|-ulinkresume|-plinkresume-test",
    r"(?<=[/:])linkresume(?=[\"'\s}`)\],.;]|$)",
    r"/opt/tolink/(?:LinkResume|dev/linkresume)[\w./-]*",
    r"LinkRag-Web/nginx/linkresume\.conf",
    r"linkresume-static-test",
    r"linkresume-job-capture-v",
    r"linkresume-dev-webhook-token",
    r"linkresume-prod\b",  # external Jenkins job name
    r"`LinkResume/",  # D3: OSS object prefix
    r"x-linkresume-(?:pipeline-version|retry)",
    r"LINKRESUME_?[A-Z0-9_]*",  # BR1: legacy env names read as fallback
    r"linkresume\\",  # escaped regex of an allowlisted token in contract rules
    r"OSS_PREFIX\W+LinkResume",  # D3: OSS object prefix
    r"(?:database|数据库|Bucket|bucket|named|must be|target|/)\s*`?linkresume\b|\blinkresume`? (?:database|数据库|Bucket)",
    r"\blinkResume\b|Link resume",  # the verb "link a resume", not the brand
    r"X-LinkResume-(?:Pdf-)?Lock-Version|x-linkresume-(?:pdf-)?lock-version",  # BR2
    r"@linkresume/",  # dev-only Electron data dir of the pre-rename package name
    r"(?<=replace\(/\^DrawOffer/, \")LinkResume",
    r"linkresume(?=-pi(?:-dev)?\b)|linkresume(?=-worker(?:-dev)?\b)",  # BR6 cutover from old containers
    # BR6: the one-time LinkCV legacy stack.
    r"[Ll][Ii][Nn][Kk][Cc][Vv]",
]
ALLOWED = re.compile("|".join(f"(?:{p})" for p in ALLOWED_TOKENS))
YAML_ALIAS = re.compile(r"^\s*- linkresume(?:-pi)?(?:-dev)?\s*$")


def tracked_files() -> list[str]:
    output = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "ls-files", "-z"], capture_output=True, check=True
    ).stdout
    return [path for path in output.decode().split("\0") if path]


def violations() -> list[str]:
    found: list[str] = []
    for relative in tracked_files():
        if any(pattern.search(relative) for pattern in ALLOWED_PATHS):
            continue
        if LEGACY.search(ALLOWED.sub("", relative)):
            found.append(f"{relative}: path contains legacy brand")
        path = REPO_ROOT / relative
        if path.is_symlink() or not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            if not LEGACY.search(line) or YAML_ALIAS.match(line):
                continue
            remaining = ALLOWED.sub("", line)
            if CONTEXT.search(line):
                remaining = re.sub(r"\b(?:LinkResume|linkresume)\b", "", remaining)
            if LEGACY.search(remaining):
                found.append(f"{relative}:{number}: {line.strip()[:160]}")
    return found


def main() -> int:
    found = violations()
    for item in found:
        print(f"ERROR legacy brand: {item}")
    if found:
        print(f"{len(found)} legacy brand occurrence(s) outside the allowlist", file=sys.stderr)
        return 1
    print("OK  旧品牌名只出现在白名单允许的位置")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
