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
    "| 任务标识 |",
    "| 一句话需求 |",
    "| 来源材料 |",
    "| 复杂度 |",
    "| 风险 |",
    "| 记录 |",
    "| 后续路径 |",
    "| 创建时间 |",
    "| 最后更新 |",
    "| 当前状态 |",
    "本模板保留完整章节库，不是逐章填写的表单",
    "未命中的章节整章删除",
    "可观察结果 → 业务规则 → 真实文件与编号步骤 → 验证证据",
    "## 第一部分 · 需求",
    "### 1. 需求描述",
    "#### 1.1 需求正文",
    "#### 1.4 可观察结果",
    "| 编号 | 完成后可以观察或断言的结果 |",
    "### 2. 现状与问题",
    "### 3. 模块分解",
    "### 4. 业务流程",
    "#### 4.1 主要流程图",
    "#### 4.3 关键规则与异常分支",
    "| 编号 | 条件或动作 | 系统行为 | 用户或下游可见结果 | 失败后的状态或数据结果 |",
    "### 5. 状态机",
    "**初始状态**",
    "**终态**",
    "## 第二部分 · 方案",
    "### 6. 整体架构",
    "### 7. 数据模型",
    "| 字段 | 类型 | 可空 | 默认值 | 业务含义 | 变更 | 约束、索引或枚举 |",
    "#### 7.4 定稿 DDL",
    "### 8. 接口契约",
    "**HTTP 方法与路径**",
    "### 9. 文件结构与实现方案",
    "#### 9.3 代码实施计划",
    "| 步骤 | 对应结果或规则 | 真实路径 | 动作 | 修改后职责或具体行为 | 依赖或消费方 | 完成判据 |",
    "### 10. 外部服务与安全边界",
    "## 第三部分 · 收口",
    "### 11. 实施顺序",
    "### 12. 已确认决策",
    "### 13. 风险与依赖",
    "### 14. 验证与验收",
    "| 编号 | 可观察结果或规则 | 验证层级 | 测试文件或命令 | 关键断言或人工步骤 | 预期证据 |",
)
SOLUTION_SKILL_REQUIRED_MARKERS = (
    "`solution.template.md` 保留原有完整章节库",
    "未命中的章节整章删除",
    "复杂任务也不要求机械填写完整章节库",
    "必须保留状态机",
    "必须保留数据模型",
    "主要流程图",
    "可观察结果 → 业务规则 → 真实文件与编号步骤 → 验证证据",
    "每行给出一个真实文件路径",
    "完整写实体关系、字段级变更、主键、唯一约束、索引、外键、枚举、定稿 DDL",
    "HTTP 契约必须同时写方法和路径",
    "直接施工路径把本节作为唯一验证契约",
    "不依赖固定章节编号",
    "没有 Issue 不阻止创建方案，也不算例外",
    "没有真实待决选择的短方案，整份展示一次并确认一次",
    "冻结阶段直接复用该选择",
)
SOLUTION_FIXED_SECTION_RE = re.compile(
    r"(?:方案文档|`?solution\.md`?)(?:的)?(?:第 ?\d+ ?节| ?\d+\.\d+)"
)
FLOW_ROUTER_REQUIRED_MARKERS = (
    "准备程度、复杂度、风险和记录需要必须分开表达",
    "七个维度仍必须在内部完整判断",
    "没有 Issue 不阻止分流",
    "只使用 4.2 至 4.5 四个维度",
    "严格风险本身不自动升级为方案先行",
    "这是当前存储能力限制，不代表任务本身复杂",
    "不要由分流阶段提前主持方案讨论",
    "其他准备为 `需澄清` 或 `需调查` 的情况",
    "准备：可实施 | 需澄清 | 需调查",
    "复杂度：简单 | 中等 | 复杂 | 暂不判定",
    "风险：常规 | 严格",
    "记录：会话内 | 持久记录",
    "路径：直接实现 | 方案先行 | 模块规划 | 暂不进入开发路径",
    "默认只向用户展示三行",
    "原因：<只写一个决定当前路径的主导事实>",
    "额外检查：无 |",
    "只有准备不足、风险严格、需要持久记录或用户主动要求查看判断依据时",
)
FLOW_ROUTER_FORBIDDEN_MARKERS = (
    "任意一条不满足即判方案先行",
    "只有五条全部满足才判直接实现",
)
IMPLEMENTATION_EXECUTION_REQUIRED_MARKERS = (
    "方案先行任务以冻结方案文档为准；"
    "直接实现以来源材料、当前确认结论和 `flow-router` 列出的严格检查项为准",
    "不因选择影响大就自动升级为模块规划",
    "没有 Issue 不阻止直接实现",
    "数据库迁移、跨端契约",
    "严格风险本身都不触发报告",
    "与方案的实际偏差",
    "已接受限制",
    "跨会话遗留风险与接手点",
)
CONTRACT_GUARD_REQUIRED_MARKERS = (
    "其他单需求分歧返回 `flow-router` 重新判断，"
    "已经明确属于方案先行时直接交 `solution-generator` 定稿",
)
REDUCTION_CONTRACTS = {
    Path("module-planning/SKILL.md"): (
        "没有 Issue 不阻塞模块规划",
        "复用该授权，不再索要一遍相同指令",
    ),
    Path("implementation-execution/implementation_report.template.md"): (
        "## 1. 与方案的实际偏差",
        "## 2. 已接受限制",
        "## 3. 跨会话遗留风险与接手点",
        "不复述正常实现、运行链路、文件清单、验证命令、人工验收或 PR 内容",
    ),
    Path("implementation-execution/SKILL.md"): (
        "没有 Issue 不阻止直接实现",
        "数据库迁移、跨端契约",
        "严格风险本身都不触发报告",
    ),
    Path("run-all-tests/SKILL.md"): (
        "**任务范围验证**",
        "**PR 全量验证**",
        "准备创建 PR 时始终运行完整 `npm run check`",
        "任务范围验证不因为“最终验证”自动变成全仓检查",
    ),
    Path("branch-pr-workflow/SKILL.md"): (
        "来源 Issue 是可选的追踪信息",
        "当前可提交内容实际运行完整 `npm run check`",
        "共享 CI 仍对对应提交运行完整质量检查",
    ),
    Path("code-review-and-quality/SKILL.md"): (
        "不把任务范围验证冒充 PR 全量检查",
        "`release_ready` 只代表同一代码快照完成了任务范围验证和质量审查",
    ),
}


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

    fixed_solution_references = sorted(
        set(SOLUTION_FIXED_SECTION_RE.findall(body))
    )
    if fixed_solution_references:
        errors.append(
            f"{skill_dir.name}: 方案流程规则仍依赖 solution.md 固定章节号 "
            + ", ".join(repr(reference) for reference in fixed_solution_references)
        )

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

    template_text = template_file.read_text(encoding="utf-8")
    missing_template = [
        marker
        for marker in SOLUTION_TEMPLATE_REQUIRED_MARKERS
        if marker not in template_text
    ]
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.is_file():
        return ["solution-generator: 缺少 SKILL.md"]
    skill_text = skill_file.read_text(encoding="utf-8")
    missing_skill = [
        marker for marker in SOLUTION_SKILL_REQUIRED_MARKERS if marker not in skill_text
    ]
    errors: list[str] = []
    if missing_template:
        errors.append(
            "solution-generator: 方案模板缺少完整章节库或施工能力 "
            + ", ".join(repr(marker) for marker in missing_template)
        )
    if missing_skill:
        errors.append(
            "solution-generator: 方案生成规则缺少按需施工契约 "
            + ", ".join(repr(marker) for marker in missing_skill)
        )
    return errors


def validate_flow_router_contract() -> list[str]:
    skill_file = SKILLS_ROOT / "flow-router" / "SKILL.md"
    if not skill_file.is_file():
        return []

    text = skill_file.read_text(encoding="utf-8")
    missing = [marker for marker in FLOW_ROUTER_REQUIRED_MARKERS if marker not in text]
    stale = [marker for marker in FLOW_ROUTER_FORBIDDEN_MARKERS if marker in text]
    errors: list[str] = []
    if missing:
        errors.append(
            "flow-router: 七维分流契约缺少必要内容 "
            + ", ".join(repr(marker) for marker in missing)
        )
    if stale:
        errors.append(
            "flow-router: 仍含旧的一票升级判据 "
            + ", ".join(repr(marker) for marker in stale)
        )
    return errors


def validate_implementation_execution_contract() -> list[str]:
    skill_file = SKILLS_ROOT / "implementation-execution" / "SKILL.md"
    if not skill_file.is_file():
        return []

    text = skill_file.read_text(encoding="utf-8")
    missing = [
        marker
        for marker in IMPLEMENTATION_EXECUTION_REQUIRED_MARKERS
        if marker not in text
    ]
    if not missing:
        return []
    return [
        "implementation-execution: 实现入口或实施报告契约缺少必要内容 "
        + ", ".join(repr(marker) for marker in missing)
    ]


def validate_contract_guard_routing() -> list[str]:
    skill_file = SKILLS_ROOT / "contract-guard" / "SKILL.md"
    if not skill_file.is_file():
        return []

    text = skill_file.read_text(encoding="utf-8")
    missing = [
        marker for marker in CONTRACT_GUARD_REQUIRED_MARKERS if marker not in text
    ]
    if not missing:
        return []
    return [
        "contract-guard: 七维分流下游契约缺少必要内容 "
        + ", ".join(repr(marker) for marker in missing)
    ]


def validate_reduction_contracts() -> list[str]:
    errors: list[str] = []
    for relative_path, markers in REDUCTION_CONTRACTS.items():
        path = SKILLS_ROOT / relative_path
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        missing = [marker for marker in markers if marker not in text]
        if missing:
            errors.append(
                f"{relative_path}: 五项减法契约缺少必要内容 "
                + ", ".join(repr(marker) for marker in missing)
            )
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
    errors.extend(validate_solution_template())
    errors.extend(validate_flow_router_contract())
    errors.extend(validate_implementation_execution_contract())
    errors.extend(validate_contract_guard_routing())
    errors.extend(validate_reduction_contracts())
    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1
    print(f"OK  已校验 {len(skill_dirs)} 个项目 Skill")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
