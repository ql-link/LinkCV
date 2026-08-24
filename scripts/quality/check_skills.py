#!/usr/bin/env python3
"""Validate LinkCV project skills and their stable artifact contracts."""

from __future__ import annotations

import json
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
    "使用正常文本按数据对象说明变更层级",
    "#### 7.2 数据结构变更",
    "结构定义片段只供开发评审，不是可直接执行的 DDL",
    "字段代码块只写字段",
    "约束变更：",
    "索引变更：",
    "#### 7.3 存量数据、兼容与迁移",
    "全部未命中时删除整节",
    "使用正常文本描述存量数据的处理范围",
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
    "第 7 章固定按实际内容连续编号",
    "新增表和已有表的字段变化都使用 SQL 风格的结构定义片段",
    "不得混入“字段定义”或“新增字段”",
    "才保留“存量数据、兼容与迁移”",
    "存量数据处理使用正常文本描述",
    "HTTP 契约必须同时写方法和路径",
    "直接施工路径把本节作为唯一验证契约",
    "不依赖固定章节编号",
    "没有 Issue 不阻止创建方案，也不算例外",
    "没有真实待决选择的短方案，整份展示一次并确认一次",
    "确认方案时直接复用该选择",
)
SOLUTION_TEMPLATE_FORBIDDEN_MARKERS = (
    "#### 7.4 定稿 DDL",
    "#### 7.3 数据结构变更",
    "| 字段 | 类型 | 可空 | 默认值 | 业务含义 | 变更 | 约束、索引或枚举 |",
    "| 数据对象 | 变更层级 | 读取方 | 写入方 | 归属与权限 | 必须保持的不变量 |",
)
SOLUTION_FIXED_SECTION_RE = re.compile(
    r"(?:方案文档|`?solution\.md`?)(?:的)?(?:第 ?\d+ ?节| ?\d+\.\d+)"
)
FLOW_ROUTER_REQUIRED_MARKERS = (
    "本技能只回答两个问题",
    "它不判断准备程度、简单/中等/复杂、严格风险、持久记录、直接实现或方案先行",
    "没有 Issue 不阻止路由",
    "纯前端",
    "纯后端",
    "前后端混合",
    "用户明确给出的控制项必须原样传给下游",
    "下一站：frontend-delivery | backend-delivery",
    "准备程度、复杂度、风险、记录需要或后端直接/方案路径变化不返回本技能",
)
FLOW_ROUTER_FORBIDDEN_MARKERS = (
    "七个维度仍必须在内部完整判断",
    "只使用 4.2 至 4.5 四个维度",
    "默认只向用户展示三行",
    "任意一条不满足即判方案先行",
    "只有五条全部满足才判直接实现",
)
BACKEND_DELIVERY_REQUIRED_MARKERS = (
    "准备程度、复杂度、风险和记录需要必须分开表达",
    "七个维度仍必须在内部完整判断",
    "没有 Issue 不阻止七维判断或交付",
    "只使用 4.2 至 4.5 四个维度",
    "严格风险本身不自动升级为方案先行",
    "记录需要不改变交付路径",
    "记录为持久记录也不自动升级方案",
    "不要为方案路径再启动第二个 Sol 规划 Agent",
    "准备为`需澄清`或`需调查`",
    "准备：可实施 | 需澄清 | 需调查",
    "复杂度：简单 | 中等 | 复杂 | 暂不判定",
    "风险：常规 | 严格",
    "记录：会话内 | 持久记录",
    "路径：直接实现 | 方案先行 | 模块规划 | 暂不进入开发路径",
    "默认只向用户展示三行",
    "原因：<只写一个决定当前路径的主导事实>",
    "额外检查：无 |",
    "只有准备不足、风险严格、需要持久记录或用户主动要求查看判断依据时",
    "`model`: `gpt-5.6-sol`",
    "`reasoning_effort`: `medium`",
    "`model`: `gpt-5.6-luna`",
    "`reasoning_effort`: `max`",
    "准备、复杂度、风险、记录或后端路径变化：留在本技能",
)
FRONTEND_DELIVERY_REQUIRED_MARKERS = (
    "标准和完整档以对话作为设计主线",
    "每轮最多问一个问题",
    "不在开工前收集完整偏好表",
    "不要追问色值、字号、圆角、精确间距、具体断点或控件坐标",
    "不设固定轮数",
    "对话中的最新明确反馈优先",
    "不要把同一个原型文件",
    "每轮从当前请求、最新反馈、浏览器实际画面、Git 差异和真实代码重新判断",
    "已有可运行路由或组件，且用户已经授权修改当前工作区",
    "全新页面、尚无可运行入口",
    "用户明确指定 Figma：使用 Figma",
    "不先询问产物格式",
    "`.specs/<KEY>/prototype/` 创建自包含的 `index.html`",
    "不新增依赖，不请求外部资源",
    "`imagegen` 只用于视觉探索",
    "只覆盖当前轮次的短交接",
    "继承真实应用壳，不自行发明导航、品牌或全局视觉语言",
    "主 Agent 在浏览器查看桌面或本轮受影响断点，并执行视觉拒收门禁",
    "确认前不得提交、推送或创建 PR",
    "不要先交付一篇 `ui-design.md`",
    "每轮由 Luna 完成一个可回退的小步修改",
    "用户的下一句反馈直接开启下一轮",
    "不要每轮运行完整测试",
    "用户明确表示方向稳定、可以收口或要求交付",
    "`model`: `gpt-5.6-sol`",
    "`reasoning_effort`: `medium`",
    "`model`: `gpt-5.6-luna`",
    "`reasoning_effort`: `max`",
)
FRONTEND_DELIVERY_FORBIDDEN_MARKERS = (
    "完整必须创建 `ui-design.md`",
    "创建或修订唯一的 `.specs/<KEY>/ui-design.md`",
    "标准和完整档在设计前必须先做一次轻量偏好确认",
    "用户确认选定方案后才实施",
)
IMPLEMENTATION_EXECUTION_REQUIRED_MARKERS = (
    "方案先行任务以当前 `solution.md` 为准；"
    "直接实现以来源材料、当前确认结论和 `backend-delivery` 七维简报列出的严格检查项为准",
    "不因选择影响大就自动升级为模块规划",
    "没有 Issue 不阻止直接实现",
    "数据库迁移、跨端契约",
    "严格风险本身都不触发报告",
    "与方案的实际偏差",
    "已接受限制",
    "跨会话遗留风险与接手点",
)
CONTRACT_GUARD_REQUIRED_MARKERS = (
    "已经明确属于方案先行的单需求分歧直接交 `solution-generator` 修订当前方案",
    "只有七维判断或后端路径可能变化时才返回 `backend-delivery`，领域可能变化时才返回 `flow-router`",
)
DELIVERY_FLOW_REQUIRED_MARKERS = {
    Path(".ai/prompts/project.md"): (
        "需求和交付信息按单向链路流转",
        "在 PR 创建后只补一条交付评论",
        "新的业务需求分支必须从最新 `origin/master` 创建",
        "由业务分支向 `dev` 提 PR",
    ),
    Path(".ai/skills/README.md"): (
        "飞书文档只作为方案或 UI 设计形成前的初始输入",
        "确认后的 `solution.md` 是后端和混合方案的实施依据",
        "## 单向交付层次",
        "| 初始设计层 | 飞书文档 |",
        "| 任务入口与跟踪层 | Issue 正文 |",
        "| 实施真相层 | 代码、配置、迁移和测试 |",
        "| 交付审阅层 | PR |",
        "| 跟踪收尾层 | 来源 Issue 的交付评论 |",
        "主链只向右推进",
    ),
    Path(".ai/skills/solution-generator/SKILL.md"): (
        "飞书文档只作为初步设计输入",
        "把已确认的取舍和被替代的来源结论写入当前 `solution.md`",
        "不更新飞书",
    ),
    Path(".ai/skills/implementation-execution/SKILL.md"): (
        "飞书冲突本身不触发 `module-planning`",
        "交付说明统一留到 PR 收口",
        "本阶段不回写飞书或 Issue",
    ),
    Path(".ai/skills/branch-pr-workflow/SKILL.md"): (
        "默认同时授权发布上述一条交付评论",
        "该授权不包含修改 Issue 正文、状态、负责人、标签或其他字段",
        "git switch -c <branch> origin/master",
        "--base dev --head <当前业务分支>",
        "同一业务需求默认只在 `dev` PR 创建后发布一条交付评论",
        "后续代码变化优先更新 PR 正文",
        "issue_delivery_comment.template.md",
    ),
    Path(".ai/skills/branch-pr-workflow/pull_request.template.md"): (
        "## 来源差异与取舍",
        "无须强一致",
        "交付目标：`dev`",
    ),
    Path(".ai/skills/branch-pr-workflow/issue_delivery_comment.template.md"): (
        "交付 PR：<PR 链接>",
        "实际交付：",
        "重要差异：",
        "验证摘要：",
        "未完成与后续：",
    ),
    Path(".specs/README.md"): (
        "飞书只提供方案或视觉设计形成前的初始输入",
        "不反向同步飞书或 Issue 正文",
        "普通文件组织、命名、测试落点",
        "PR 创建后只追加一条交付评论",
    ),
}
DELIVERY_FLOW_FORBIDDEN_MARKERS = {
    Path(".ai/skills/README.md"): (
        "其结论优先于本地推断",
        "也不向任何 Issue 系统写回评论",
    ),
    Path(".ai/skills/solution-generator/SKILL.md"): (
        "其已确认结论优先于本地推断",
        "停止并交 `module-planning` 更新上游",
    ),
    Path(".ai/skills/implementation-execution/SKILL.md"): (
        "先更新并读回飞书",
        "已有飞书结论需要更新时才进入",
    ),
}
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
        "不写入工作流状态",
    ),
}
STATELESS_SPEC_REQUIRED_MARKERS = {
    Path(".ai/prompts/project.md"): (
        "以 `solution.md` 为中心",
        "跨会话不继承旧测试结论",
    ),
    Path(".ai/skills/solution-generator/SKILL.md"): (
        "`solution.md` 是方案任务的唯一中心文档",
        "AI 根据当前请求、Spec 文档、视觉产物、Git 差异、真实代码和实际测试判断下一步",
        "不创建额外机器状态文件",
    ),
    Path(".specs/README.md"): (
        "顺序是内容关系，不是机器状态机",
        "AI 根据最新用户指令、当前方案、确认的视觉产物、Git 差异、真实代码和本次验证判断下一步",
        "跨会话不继承以前会话的测试结论",
    ),
    Path(".ai/skills/run-all-tests/SKILL.md"): (
        "不创建验证状态文件",
        "不继承较早会话的“已通过”",
    ),
    Path(".ai/skills/code-review-and-quality/SKILL.md"): (
        "不写入工作流状态",
    ),
}
STATEFUL_SPEC_GLOBAL_FORBIDDEN_MARKERS = (
    "state.yaml",
    "state.yml",
    "flow_guard.py",
    "scripts/spec/",
    "npm run spec --",
    "spec init",
    "spec status",
    "spec route",
    "--refreeze",
    "spec freeze",
    "spec check",
    "spec verify",
    "spec review",
    "spec amend",
)
STATEFUL_SPEC_CORE_FORBIDDEN_MARKERS = (
    "status.md",
    "release_ready",
    "quality_review",
)
STATELESS_SPEC_FORMAL_ROOTS = (
    Path(".ai/prompts/project.md"),
    Path(".ai/skills"),
    Path(".specs/README.md"),
)
STATELESS_SPEC_CORE_ROOTS = (
    Path(".ai/prompts/project.md"),
    Path(".ai/skills/README.md"),
    Path(".ai/skills/flow-router"),
    Path(".ai/skills/backend-delivery"),
    Path(".ai/skills/frontend-delivery"),
    Path(".ai/skills/solution-generator"),
    Path(".ai/skills/acceptance-generator"),
    Path(".ai/skills/implementation-execution"),
    Path(".ai/skills/manual-acceptance"),
    Path(".ai/skills/run-all-tests"),
    Path(".ai/skills/code-review-and-quality"),
    Path(".ai/skills/branch-pr-workflow"),
    Path(".specs/README.md"),
)
STATELESS_SPEC_TEXT_SUFFIXES = {".feature", ".json", ".md", ".txt", ".yaml", ".yml"}
SOLUTION_TEMPLATE_STATE_FIELD_RE = re.compile(
    r"^\|\s*(?:\*\*\s*)?(当前状态|确认记录|当前阶段|工作流状态|整体确认)"
    r"(?:\s*\*\*)?\s*\|",
    re.MULTILINE,
)


def active_rule_lines(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    return {
        stripped
        for line in path.read_text(encoding="utf-8").splitlines()
        if (stripped := line.strip()) and not stripped.startswith("#")
    }


def collect_formal_text_files(relative_roots: tuple[Path, ...]) -> list[Path]:
    files: list[Path] = []
    for relative_root in relative_roots:
        root = REPO_ROOT / relative_root
        if root.is_file():
            files.append(root)
        elif root.is_dir():
            files.extend(
                path
                for path in root.rglob("*")
                if path.is_file() and path.suffix.lower() in STATELESS_SPEC_TEXT_SUFFIXES
            )
    return files


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
    stale_template = [
        marker
        for marker in SOLUTION_TEMPLATE_FORBIDDEN_MARKERS
        if marker in template_text
    ]
    if stale_template:
        errors.append(
            "solution-generator: 方案模板仍包含旧的可执行 DDL 展示契约 "
            + ", ".join(repr(marker) for marker in stale_template)
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
            "flow-router: 薄领域入口契约缺少必要内容 "
            + ", ".join(repr(marker) for marker in missing)
        )
    if stale:
        errors.append(
            "flow-router: 仍含应由 backend-delivery 拥有的路径判断 "
            + ", ".join(repr(marker) for marker in stale)
        )
    return errors


def validate_backend_delivery_contract() -> list[str]:
    skill_file = SKILLS_ROOT / "backend-delivery" / "SKILL.md"
    if not skill_file.is_file():
        return []

    text = skill_file.read_text(encoding="utf-8")
    missing = [
        marker for marker in BACKEND_DELIVERY_REQUIRED_MARKERS if marker not in text
    ]
    if not missing:
        return []
    return [
        "backend-delivery: 七维判断、模型路由或回流契约缺少必要内容 "
        + ", ".join(repr(marker) for marker in missing)
    ]


def validate_frontend_delivery_contract() -> list[str]:
    skill_file = SKILLS_ROOT / "frontend-delivery" / "SKILL.md"
    if not skill_file.is_file():
        return []

    text = skill_file.read_text(encoding="utf-8")
    missing = [
        marker for marker in FRONTEND_DELIVERY_REQUIRED_MARKERS if marker not in text
    ]
    stale = [
        marker for marker in FRONTEND_DELIVERY_FORBIDDEN_MARKERS if marker in text
    ]
    errors: list[str] = []
    if missing:
        errors.append(
            "frontend-delivery: 对话式可视设计契约缺少必要内容 "
            + ", ".join(repr(marker) for marker in missing)
        )
    if stale:
        errors.append(
            "frontend-delivery: 仍存在一次性冻结设计的过期契约 "
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
        "contract-guard: 领域或七维回流契约缺少必要内容 "
        + ", ".join(repr(marker) for marker in missing)
    ]


def validate_delivery_flow_contract() -> list[str]:
    full_repository = all(
        (REPO_ROOT / relative_path).is_file()
        for relative_path in (
            Path("package.json"),
            Path(".ai/prompts/project.md"),
            Path(".specs/README.md"),
        )
    )
    if not full_repository:
        return []

    errors: list[str] = []
    for relative_path, markers in DELIVERY_FLOW_REQUIRED_MARKERS.items():
        path = REPO_ROOT / relative_path
        if not path.is_file():
            errors.append(f"单向交付: 缺少正式文件 {relative_path.as_posix()}")
            continue
        text = path.read_text(encoding="utf-8")
        missing = [marker for marker in markers if marker not in text]
        if missing:
            errors.append(
                f"{relative_path.as_posix()}: 单向交付契约缺少必要内容 "
                + ", ".join(repr(marker) for marker in missing)
            )

    for relative_path, markers in DELIVERY_FLOW_FORBIDDEN_MARKERS.items():
        path = REPO_ROOT / relative_path
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        stale = [marker for marker in markers if marker in text]
        if stale:
            errors.append(
                f"{relative_path.as_posix()}: 仍含旧的并行来源或禁止收尾规则 "
                + ", ".join(repr(marker) for marker in stale)
            )
    return errors


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
                f"{relative_path.as_posix()}: 五项减法契约缺少必要内容 "
                + ", ".join(repr(marker) for marker in missing)
            )
    return errors


def validate_stateless_spec_contract() -> list[str]:
    errors: list[str] = []
    spec_script_root = REPO_ROOT / "scripts" / "spec"
    if spec_script_root.is_dir():
        for path in sorted(item for item in spec_script_root.rglob("*") if item.is_file()):
            errors.append(
                "无状态 Spec: 不应在 scripts/spec 下重建状态管理脚本 "
                f"{path.relative_to(REPO_ROOT).as_posix()}"
            )

    package_file = REPO_ROOT / "package.json"
    if package_file.is_file():
        try:
            package = json.loads(package_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            package = None
        scripts = package.get("scripts") if isinstance(package, dict) else None
        if isinstance(scripts, dict):
            if "spec" in scripts:
                errors.append(
                    "无状态 Spec: package.json 不应重建 npm run spec 状态入口"
                )
            for script_name, command in scripts.items():
                if isinstance(command, str) and (
                    "scripts/spec/" in command or "flow_guard.py" in command
                ):
                    errors.append(
                        "无状态 Spec: package.json 脚本 "
                        f"{script_name!r} 不应引用已删除的 Spec 状态工具"
                    )

    full_repository = all(
        (REPO_ROOT / relative_path).is_file()
        for relative_path in (
            Path("package.json"),
            Path(".ai/prompts/project.md"),
            Path(".specs/README.md"),
        )
    )
    if full_repository:
        if ".specs/*/" not in active_rule_lines(REPO_ROOT / ".worktreeinclude"):
            errors.append(
                "无状态 Spec: .worktreeinclude 必须包含有效的 .specs/*/ 复制规则"
            )
        if ".specs/*/" not in active_rule_lines(REPO_ROOT / ".gitignore"):
            errors.append(
                "无状态 Spec: .gitignore 必须包含有效的 .specs/*/ 忽略规则"
            )

    for relative_path, markers in STATELESS_SPEC_REQUIRED_MARKERS.items():
        path = REPO_ROOT / relative_path
        if not path.is_file():
            if full_repository:
                errors.append(
                    f"无状态 Spec: 缺少正式文件 {relative_path.as_posix()}"
                )
            continue
        if not full_repository and not str(relative_path).startswith(".ai/skills/"):
            continue
        text = path.read_text(encoding="utf-8")
        missing = [marker for marker in markers if marker not in text]
        if missing:
            errors.append(
                f"{relative_path.as_posix()}: 无状态 Spec 契约缺少必要内容 "
                + ", ".join(repr(marker) for marker in missing)
            )

    for path in collect_formal_text_files(STATELESS_SPEC_FORMAL_ROOTS):
        text = path.read_text(encoding="utf-8")
        stale = [
            marker for marker in STATEFUL_SPEC_GLOBAL_FORBIDDEN_MARKERS if marker in text
        ]
        if stale:
            errors.append(
                f"{path.relative_to(REPO_ROOT).as_posix()}: 仍含已删除的状态工作流 "
                + ", ".join(repr(marker) for marker in stale)
            )

    for path in collect_formal_text_files(STATELESS_SPEC_CORE_ROOTS):
        text = path.read_text(encoding="utf-8")
        stale = [
            marker for marker in STATEFUL_SPEC_CORE_FORBIDDEN_MARKERS if marker in text
        ]
        if stale:
            errors.append(
                f"{path.relative_to(REPO_ROOT).as_posix()}: 核心工作流仍含换皮状态字段 "
                + ", ".join(repr(marker) for marker in stale)
            )

    template = SKILLS_ROOT / "solution-generator" / "solution.template.md"
    if template.is_file():
        text = template.read_text(encoding="utf-8")
        rebuilt_state = sorted(set(SOLUTION_TEMPLATE_STATE_FIELD_RE.findall(text)))
        if rebuilt_state:
            errors.append(
                "solution-generator/solution.template.md: 不应重建文档级状态字段 "
                + ", ".join(repr(marker) for marker in rebuilt_state)
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
    errors.extend(validate_backend_delivery_contract())
    errors.extend(validate_frontend_delivery_contract())
    errors.extend(validate_implementation_execution_contract())
    errors.extend(validate_contract_guard_routing())
    errors.extend(validate_delivery_flow_contract())
    errors.extend(validate_reduction_contracts())
    errors.extend(validate_stateless_spec_contract())
    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1
    print(f"OK  已校验 {len(skill_dirs)} 个项目 Skill")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
