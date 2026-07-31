#!/usr/bin/env python3
"""Validate LinkCV project skills and their stable artifact contracts."""

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
    "src/core/",
)
ALLOWED_AI_ENTRIES = {"prompts", "skills"}
SOLUTION_TEMPLATE_REQUIRED_MARKERS = (
    "# <KEY> · <标题> 方案文档",
    "| 需求编号 | <KEY> |",
    "| 一句话需求 |",
    "| 来源 Issue |",
    "| 后续路径 |",
    "| 创建时间 |",
    "| 最后更新 |",
    "| 当前状态 |",
    "## 第一部分 · 需求",
    "### 1. 需求描述",
    "#### 1.1 需求正文",
    "#### 1.2 背景与动机",
    "**问题来源**",
    "**为什么现在做**",
    "**不做会怎样**",
    "#### 1.3 使用场景",
    "| 场景 | 使用者 | 什么时候用 | 期望结果 |",
    "#### 1.4 交付结果",
    "#### 1.5 本次不做",
    "### 2. 现状与问题",
    "### 3. 模块分解",
    "| 编号 | 模块 | 业务职责 | 依赖模块 | 交付顺序 | 可否独立验收 |",
    "**边界**",
    "**完成信号**",
    "**依赖前提**",
    "### 4. 业务流程",
    "#### 4.1 主流程图",
    "#### 4.2 流程详解",
    "#### 4.3 异常分支",
    "| 异常分支 | 触发条件 | 系统行为 | 用户或下游感知 | 状态或数据结果 |",
    "### 5. 状态机",
    "**初始状态**",
    "**终态**",
    "| 起始状态 | 事件或条件 | 目标状态 | 触发者 | 并发或重复触发处理 | 副作用 |",
    "**不允许的流转**",
    "## 第二部分 · 方案",
    "### 6. 整体架构",
    "#### 6.1 架构图",
    "#### 6.2 分层与职责",
    "| 层次 | 承担什么 | 不承担什么 | 涉及模块 |",
    "#### 6.3 关键数据流",
    "#### 6.4 技术选型与取舍",
    "| 决策点 | 选定方案 | 放弃的方案 | 代价与理由 |",
    "### 7. 数据模型",
    "#### 7.1 实体关系",
    "| 字段 | 类型 | 可空 | 默认值 | 业务含义 | 变更 |",
    "**主键**",
    "**唯一约束**",
    "**索引**",
    "**外键与关联策略**",
    "**枚举取值**",
    "#### 7.3 定稿 DDL",
    "#### 7.4 旧数据与兼容",
    "**真值源核对**",
    "**回滚与不可逆点**",
    "### 8. 接口契约",
    "**共享类型影响**",
    "**消费方**",
    "### 9. 文件结构与实现方案",
    "#### 9.1 目录树",
    "#### 9.2 文件职责",
    "| 文件或模块 | 动作 | 修改后职责 | 所属模块 | 影响方 |",
    "**实现步骤**",
    "**验证方式**",
    "**实现要点**",
    "**复用能力**",
    "### 10. 外部服务与安全边界",
    "## 第三部分 · 收口",
    "### 11. 实施顺序",
    "| 步骤 | 内容 | 模块 | 涉及文件 | 完成判据 |",
    "### 12. 已确认决策",
    "| 编号 | 决策事项 | 结论 | 影响章节 | 确认来源 |",
    "### 13. 风险与依赖",
    "| 风险或依赖 | 触发条件 | 影响 | 当前判断或应对方向 |",
)


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


def validate_solution_template() -> list[str]:
    skill_dir = SKILLS_ROOT / "solution-generator"
    if not skill_dir.is_dir():
        return []

    template_file = skill_dir / "solution.template.md"
    if not template_file.is_file():
        return ["solution-generator: 缺少 solution.template.md"]

    text = template_file.read_text(encoding="utf-8")
    missing = [
        marker for marker in SOLUTION_TEMPLATE_REQUIRED_MARKERS if marker not in text
    ]
    if not missing:
        return []
    return [
        "solution-generator: 方案文档模板缺少固定结构 "
        + ", ".join(repr(marker) for marker in missing)
    ]


def main() -> int:
    if not SKILLS_ROOT.is_dir():
        print("ERROR 缺少 .ai/skills", file=sys.stderr)
        return 2
    skill_dirs = sorted(path for path in SKILLS_ROOT.iterdir() if path.is_dir())
    errors = validate_ai_layout()
    errors.extend(
        error for skill_dir in skill_dirs for error in validate_skill(skill_dir)
    )
    errors.extend(validate_solution_template())
    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1
    print(f"OK  已校验 {len(skill_dirs)} 个项目 Skill")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
