#!/usr/bin/env python3
"""校验长期项目文档索引、链接和代码到文档同步关系。"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml


REPO_ROOT = Path(
    os.environ.get("LINKCV_REPO_ROOT", Path(__file__).resolve().parents[2])
).resolve()
DOCS_ROOT = REPO_ROOT / "docs"
DEFAULT_CONFIG = REPO_ROOT / "scripts" / "quality" / "doc-sync-rules.yaml"
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


@dataclass(frozen=True)
class Rule:
    identifier: str
    description: str
    when_changed: tuple[str, ...]
    must_update: tuple[str, ...]


def glob_regex(pattern: str) -> re.Pattern[str]:
    result: list[str] = []
    index = 0
    while index < len(pattern):
        char = pattern[index]
        if char == "*" and index + 1 < len(pattern) and pattern[index + 1] == "*":
            if index + 2 < len(pattern) and pattern[index + 2] == "/":
                result.append("(?:.*/)?")
                index += 3
            else:
                result.append(".*")
                index += 2
        elif char == "*":
            result.append("[^/]*")
            index += 1
        elif char == "?":
            result.append("[^/]")
            index += 1
        else:
            result.append(re.escape(char))
            index += 1
    return re.compile("^" + "".join(result) + "$")


def matches(path: str, patterns: tuple[str, ...]) -> bool:
    return any(glob_regex(pattern).match(path) for pattern in patterns)


def load_rules(path: Path) -> list[Rule]:
    if not path.is_file():
        raise ValueError(f"规则文件不存在：{path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if data.get("version") != 1:
        raise ValueError("文档同步规则 version 必须为 1")

    rules: list[Rule] = []
    seen: set[str] = set()
    for raw in data.get("rules", []):
        identifier = raw.get("id")
        when_changed = raw.get("when_changed") or []
        must_update = raw.get("must_update") or []
        if not isinstance(identifier, str) or not identifier:
            raise ValueError("每条文档同步规则必须有 id")
        if identifier in seen:
            raise ValueError(f"文档同步规则 id 重复：{identifier}")
        if not all(isinstance(value, str) and value for value in when_changed):
            raise ValueError(f"规则 {identifier} 的 when_changed 无效")
        if not all(isinstance(value, str) and value for value in must_update):
            raise ValueError(f"规则 {identifier} 的 must_update 无效")
        if not when_changed or not must_update:
            raise ValueError(f"规则 {identifier} 必须同时声明 when_changed 和 must_update")
        seen.add(identifier)
        rules.append(
            Rule(
                identifier=identifier,
                description=str(raw.get("description") or ""),
                when_changed=tuple(when_changed),
                must_update=tuple(must_update),
            )
        )
    if not rules:
        raise ValueError("文档同步规则不能为空")
    return rules


def check_docs_structure() -> list[str]:
    if not DOCS_ROOT.is_dir():
        return ["缺少 docs 目录"]
    index = DOCS_ROOT / "README.md"
    if not index.is_file():
        return ["缺少 docs/README.md 文档索引"]

    errors: list[str] = []
    index_body = index.read_text(encoding="utf-8")
    indexed_targets: set[Path] = set()

    for doc in sorted(DOCS_ROOT.rglob("*.md")):
        body = doc.read_text(encoding="utf-8")
        for raw_target in MARKDOWN_LINK_RE.findall(body):
            target = raw_target.split("#", 1)[0].strip()
            if not target or target.startswith(("http://", "https://", "mailto:")):
                continue
            resolved = (doc.parent / target).resolve()
            if not resolved.exists():
                errors.append(
                    f"{doc.relative_to(REPO_ROOT)}: 链接目标不存在 {raw_target}"
                )
            if doc == index and resolved.suffix == ".md":
                indexed_targets.add(resolved)

    for doc in sorted(DOCS_ROOT.rglob("*.md")):
        if doc == index:
            continue
        if doc.resolve() not in indexed_targets:
            errors.append(f"docs/README.md 未索引 {doc.relative_to(DOCS_ROOT)}")

    if "`.specs/`" not in index_body and "`.specs" not in index_body:
        errors.append("docs/README.md 必须区分 docs 与 .specs")
    return errors


def git_output(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise ValueError(result.stderr.strip() or f"git {' '.join(args)} 执行失败")
    return result.stdout


def working_files() -> set[str]:
    changed: set[str] = set()
    for line in git_output("status", "--porcelain=v1", "--untracked-files=all").splitlines():
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if path:
            changed.add(path)
    return changed


def changed_files(args: argparse.Namespace) -> set[str]:
    if args.files:
        return set(args.files)
    if args.staged:
        output = git_output("diff", "--cached", "--name-only", "--diff-filter=ACMR")
        return {line for line in output.splitlines() if line}
    if args.base:
        output = git_output("diff", "--name-only", "--diff-filter=ACMR", f"{args.base}...HEAD")
        return {line for line in output.splitlines() if line}
    if args.working:
        return working_files()

    explicit_base = os.environ.get("DOCS_SYNC_BASE")
    if explicit_base and set(explicit_base) != {"0"}:
        output = git_output(
            "diff", "--name-only", "--diff-filter=ACMR", f"{explicit_base}...HEAD"
        )
        return {line for line in output.splitlines() if line}

    github_base = os.environ.get("GITHUB_BASE_REF")
    if github_base:
        output = git_output(
            "diff", "--name-only", "--diff-filter=ACMR", f"origin/{github_base}...HEAD"
        )
        return {line for line in output.splitlines() if line}
    return working_files()


def find_violations(rules: list[Rule], changed: set[str]) -> list[str]:
    errors: list[str] = []
    for rule in rules:
        triggers = sorted(path for path in changed if matches(path, rule.when_changed))
        if not triggers:
            continue
        missing = [
            required
            for required in rule.must_update
            if not any(glob_regex(required).match(path) for path in changed)
        ]
        if missing:
            errors.append(
                f"{rule.identifier}: {rule.description}；触发 {', '.join(triggers)}；"
                f"缺少 {', '.join(missing)}"
            )
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="校验 LinkCV 长期项目文档同步")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--staged", action="store_true")
    modes.add_argument("--working", action="store_true")
    modes.add_argument("--base")
    modes.add_argument("--files", nargs="+")
    modes.add_argument("--self-check", action="store_true")
    args = parser.parse_args(argv)

    try:
        rules = load_rules(args.config)
        errors = check_docs_structure()
        changed: set[str] = set()
        if not args.self_check:
            changed = changed_files(args)
            errors.extend(find_violations(rules, changed))
    except ValueError as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        return 2

    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1

    if args.self_check:
        print(f"OK  已校验 {len(rules)} 条文档同步规则和文档索引")
    else:
        print(f"OK  已检查 {len(changed)} 个变更文件和 {len(rules)} 条文档同步规则")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
