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
        return f"目标不存在: {target_rel}"

    expected = expected_target(link, target)
    if link.is_symlink():
        actual = os.readlink(link)
        if actual != expected:
            return f"{link_rel} 指向 {actual}，预期 {expected}"
        if not link.resolve().exists():
            return f"{link_rel} 是死链"
        print(f"OK  {link_rel} -> {actual}")
        return None

    if link.exists():
        return f"拒绝覆盖已有文件或目录: {link_rel}"

    if check_only:
        return f"缺少链接: {link_rel}"

    link.parent.mkdir(parents=True, exist_ok=True)
    try:
        link.symlink_to(expected, target_is_directory=target.is_dir())
    except OSError as exc:
        return f"无法创建 {link_rel}: {exc}"
    print(f"ADD {link_rel} -> {expected}")
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="只检查，不创建缺失链接")
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
