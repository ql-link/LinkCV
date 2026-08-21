#!/usr/bin/env python3
"""Create missing AI entry-point symlinks without overwriting user files."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(os.environ.get("LINKCV_REPO_ROOT", Path(__file__).resolve().parents[2])).resolve()
LINKS = {
    "AGENTS.md": ".ai/prompts/project.md",
    "CLAUDE.md": ".ai/prompts/project.md",
    ".agents/skills": ".ai/skills",
    ".claude/skills": ".ai/skills",
}


def expected_target(link: Path, target: Path) -> str:
    return os.path.relpath(target, link.parent)


def ensure_link(link_rel: str, target_rel: str, check_only: bool) -> str | None:
    link = REPO_ROOT / link_rel
    target = REPO_ROOT / target_rel
    if not target.exists():
        return f"\u76ee\u6807\u4e0d\u5b58\u5728: {target_rel}"

    expected = expected_target(link, target)

    # Symlink check (preferred on Linux/macOS)
    if link.is_symlink():
        actual = os.readlink(link)
        expected = expected.rstrip('\n')
        actual = actual.rstrip('\n')
        if actual.rstrip('\n') != expected.rstrip('\n'):
            return f"{link_rel} \u6307\u5411 {actual}\uff0c\u9884\u671f{expected}"
        if not link.resolve().exists():
            return f"{link_rel} \u662f\u6b7b\u94fe\u63a5"
        print(f"OK  {link_rel} -> {actual}")
        return None

    # Windows fallback: accept regular file whose content matches expected target
    if link.exists() and link.is_file():
        raw = link.read_text(encoding="utf-8").strip().replace("/", os.sep)
        if raw == expected.replace("/", os.sep):
            actual_target = target_rel.replace("/", os.sep)
            print(f"OK  {link_rel} -> {actual_target}")
            return None

    # Directory fallback for .agents/skills etc.
    if link.exists() and link.is_dir():
        content_file = link / "content"
        if content_file.exists() and content_file.is_file():
            raw = content_file.read_text(encoding="utf-8").strip().replace("/", os.sep)
            if raw == expected.replace("/", os.sep):
                print(f"OK  {link_rel} -> {target_rel.replace(chr(47), os.sep)}")
                return None

    if link.exists():
        return f"\u62d2\u7edd\u8986\u76d6\u5df2\u6709\u6587\u4ef6\u6216\u76ee\u5f55: {link_rel}"

    if check_only:
        return f"\u7f3a\u5c11\u94fe\u63a5: {link_rel}"

    link.parent.mkdir(parents=True, exist_ok=True)
    try:
        link.symlink_to(expected, target_is_directory=target.is_dir())
    except OSError as exc:
        return f"\u65e0\u6cd5\u521b\u5efa {link_rel}: {exc}"
    print(f"ADD {link_rel} -> {expected}")
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="\u53ea\u68c0\u67e5\uff0c\u4e0d\u521b\u5efa\u7f3a\u5931\u94fe\u63a5")
    args = parser.parse_args()

    failures = [
        error
        for link_rel, target_rel in LINKS.items()
        if (error := ensure_link(link_rel, target_rel, args.check))
    ]
    if failures:
        for failure in failures:
            print(f"ERROR {failure}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
