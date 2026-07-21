#!/usr/bin/env python3
"""Validate LinkCV project skills for discovery and stale references."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(
    os.environ.get("LINKCV_REPO_ROOT", Path(__file__).resolve().parents[2])
).resolve()
AI_ROOT = REPO_ROOT / ".ai"
SKILLS_ROOT = REPO_ROOT / ".ai" / "skills"
NAME_RE = re.compile(r"^[a-z0-9-]+$")
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
STALE_REFERENCES = (
    ".agent/skills",
    "docs/api/schemas/elasticsearch.md",
    "scripts/acceptance/",
    "tests/unit/",
    "src/core/",
)
ALLOWED_AI_ENTRIES = {"prompts", "skills"}


def validate_ai_layout() -> list[str]:
    if not AI_ROOT.is_dir():
        return ["缺少 .ai 目录"]

    errors: list[str] = []
    unexpected = sorted(
        path.name for path in AI_ROOT.iterdir() if path.name not in ALLOWED_AI_ENTRIES
    )
    if unexpected:
        errors.append(
            ".ai 顶层含未归属目录或文件 "
            f"{unexpected}；长期知识应放 docs，机器规则应放 scripts/quality"
        )
    if not (AI_ROOT / "prompts" / "project.md").is_file():
        errors.append("缺少 .ai/prompts/project.md 项目规则源")
    if not (SKILLS_ROOT / "README.md").is_file():
        errors.append("缺少 .ai/skills/README.md Skill 注册表")
    return errors


def parse_frontmatter(text: str) -> tuple[dict[str, object] | None, str]:
    if not text.startswith("---\n"):
        return None, text
    end = text.find("\n---\n", 4)
    if end < 0:
        return None, text
    try:
        value = yaml.safe_load(text[4:end])
    except yaml.YAMLError:
        return None, text
    return (value if isinstance(value, dict) else None), text[end + 5 :]


def validate_skill(skill_dir: Path) -> list[str]:
    errors: list[str] = []
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.is_file():
        return [f"{skill_dir.name}: 缺少 SKILL.md"]

    text = skill_file.read_text(encoding="utf-8")
    metadata, body = parse_frontmatter(text)
    if metadata is None:
        return [f"{skill_dir.name}: frontmatter 无法解析"]

    name = metadata.get("name")
    description = metadata.get("description")
    if name != skill_dir.name or not isinstance(name, str) or not NAME_RE.fullmatch(name):
        errors.append(f"{skill_dir.name}: name 必须与目录名一致并使用小写连字符")
    if not isinstance(description, str) or len(description.strip()) < 40:
        errors.append(f"{skill_dir.name}: description 过短或缺失触发信息")
    extra = set(metadata) - {"name", "description"}
    if extra:
        errors.append(f"{skill_dir.name}: frontmatter 含未支持字段 {sorted(extra)}")
    if "TODO" in text or "[TODO" in text:
        errors.append(f"{skill_dir.name}: 仍含模板占位内容")

    for stale in STALE_REFERENCES:
        if stale in body:
            errors.append(f"{skill_dir.name}: 含过期源项目引用 {stale}")

    for target in MARKDOWN_LINK_RE.findall(body):
        if target.startswith(("http://", "https://", "#")):
            continue
        resolved = (skill_file.parent / target.split("#", 1)[0]).resolve()
        if not resolved.exists():
            errors.append(f"{skill_dir.name}: Markdown 链接不存在 {target}")

    agent_file = skill_dir / "agents" / "openai.yaml"
    if agent_file.is_file():
        try:
            agent_metadata = yaml.safe_load(agent_file.read_text(encoding="utf-8"))
        except yaml.YAMLError:
            agent_metadata = None
        interface = agent_metadata.get("interface") if isinstance(agent_metadata, dict) else None
        if not isinstance(interface, dict):
            errors.append(f"{skill_dir.name}: agents/openai.yaml 缺少 interface")
        else:
            short_description = interface.get("short_description")
            default_prompt = interface.get("default_prompt")
            if not isinstance(short_description, str) or not 25 <= len(short_description) <= 64:
                errors.append(f"{skill_dir.name}: short_description 长度必须为 25-64")
            if not isinstance(default_prompt, str) or f"${skill_dir.name}" not in default_prompt:
                errors.append(f"{skill_dir.name}: default_prompt 必须显式包含 ${skill_dir.name}")
    return errors


def main() -> int:
    if not SKILLS_ROOT.is_dir():
        print("ERROR 缺少 .ai/skills", file=sys.stderr)
        return 2
    skill_dirs = sorted(path for path in SKILLS_ROOT.iterdir() if path.is_dir())
    errors = validate_ai_layout()
    errors.extend(
        error for skill_dir in skill_dirs for error in validate_skill(skill_dir)
    )
    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1
    print(f"OK  已校验 {len(skill_dirs)} 个项目 Skill")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
