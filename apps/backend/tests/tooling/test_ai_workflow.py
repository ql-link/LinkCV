from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[4]
LINK_SETUP = REPO_ROOT / "scripts" / "setup" / "setup_ai_links.py"
SKILL_CHECK = REPO_ROOT / "scripts" / "quality" / "check_skills.py"
DOCS_SYNC = REPO_ROOT / "scripts" / "quality" / "check_docs_sync.py"
RUNTIME_CONTRACTS = REPO_ROOT / "scripts" / "quality" / "check_runtime_contracts.py"
RUNTIME_CONTRACT_RULES = REPO_ROOT / "scripts" / "quality" / "runtime-contract-rules.yaml"
PR_TEMPLATE = (
    REPO_ROOT / ".ai" / "skills" / "branch-pr-workflow" / "pull_request.template.md"
)


def run_script(script: Path, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    command_env = os.environ.copy()
    command_env.update(env or {})
    return subprocess.run(
        [sys.executable, str(script), *args],
        cwd=REPO_ROOT,
        env=command_env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_link_setup_creates_missing_links_and_is_idempotent(tmp_path: Path) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "skills").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text("rules", encoding="utf-8")
    env = {"LINKCV_REPO_ROOT": str(tmp_path)}

    first = run_script(LINK_SETUP, env=env)
    second = run_script(LINK_SETUP, "--check", env=env)

    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    assert (tmp_path / "AGENTS.md").is_symlink()
    assert (tmp_path / ".agents" / "skills").resolve() == (tmp_path / ".ai" / "skills")


def test_link_setup_refuses_to_overwrite_existing_file(tmp_path: Path) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "skills").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text("new", encoding="utf-8")
    agents = tmp_path / "AGENTS.md"
    agents.write_text("keep", encoding="utf-8")

    result = run_script(LINK_SETUP, env={"LINKCV_REPO_ROOT": str(tmp_path)})

    assert result.returncode == 1
    assert "拒绝覆盖" in result.stderr
    assert agents.read_text(encoding="utf-8") == "keep"


def test_spec_workflow_has_no_machine_state_layer() -> None:
    package = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
    template = (
        REPO_ROOT / ".ai" / "skills" / "solution-generator" / "solution.template.md"
    ).read_text(encoding="utf-8")

    assert "spec" not in package["scripts"]
    assert not (REPO_ROOT / "scripts" / "spec" / "flow_guard.py").exists()
    worktree_rules = {
        line.strip()
        for line in (REPO_ROOT / ".worktreeinclude")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    ignore_rules = {
        line.strip()
        for line in (REPO_ROOT / ".gitignore")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    assert ".specs/*/" in worktree_rules
    assert ".specs/*/" in ignore_rules
    assert "| 当前状态 |" not in template
    assert "| 确认记录 |" not in template
    assert "| 当前阶段 |" not in template


def test_skill_check_protects_stateless_spec_contract(tmp_path: Path) -> None:
    cases = (
        (
            "remove-center",
            "required-marker",
            "solution-generator/SKILL.md: 无状态 Spec 契约缺少必要内容",
        ),
        (
            "add-state-reference",
            "forbidden-marker",
            "仍含已删除的状态工作流 'state.yaml'",
        ),
        (
            "add-state-yml-reference",
            "forbidden-yml-marker",
            "仍含已删除的状态工作流 'state.yml'",
        ),
        (
            "add-template-status",
            "template-status",
            "不应重建文档级状态字段 '当前状态'",
        ),
        (
            "add-template-phase",
            "template-phase",
            "不应重建文档级状态字段 '当前阶段'",
        ),
        (
            "restore-state-script",
            "legacy-script",
            "不应在 scripts/spec 下重建状态管理脚本 scripts/spec/flow_guard.py",
        ),
        (
            "add-renamed-state-script",
            "renamed-state-script",
            "不应在 scripts/spec 下重建状态管理脚本 scripts/spec/workflow.py",
        ),
        (
            "restore-spec-command",
            "legacy-command",
            "package.json 不应重建 npm run spec 状态入口",
        ),
        (
            "add-renamed-state-command",
            "renamed-state-command",
            "package.json 脚本 'workflow:state' 不应引用已删除的 Spec 状态工具",
        ),
        (
            "remove-ignore-rule",
            "missing-ignore-rule",
            ".gitignore 必须包含有效的 .specs/*/ 忽略规则",
        ),
        (
            "comment-copy-rule",
            "commented-copy-rule",
            ".worktreeinclude 必须包含有效的 .specs/*/ 复制规则",
        ),
    )

    base_root = tmp_path / "base"
    (base_root / ".ai" / "prompts").mkdir(parents=True)
    (base_root / ".ai" / "skills").mkdir(parents=True)
    (base_root / ".specs").mkdir(parents=True)
    shutil.copy2(
        REPO_ROOT / ".ai" / "prompts" / "project.md",
        base_root / ".ai" / "prompts" / "project.md",
    )
    shutil.copy2(
        REPO_ROOT / ".ai" / "skills" / "README.md",
        base_root / ".ai" / "skills" / "README.md",
    )
    for skill_name in (
        "solution-generator",
        "implementation-execution",
        "branch-pr-workflow",
        "run-all-tests",
        "code-review-and-quality",
    ):
        shutil.copytree(
            REPO_ROOT / ".ai" / "skills" / skill_name,
            base_root / ".ai" / "skills" / skill_name,
        )
    shutil.copy2(
        REPO_ROOT / ".specs" / "README.md",
        base_root / ".specs" / "README.md",
    )
    shutil.copy2(REPO_ROOT / "package.json", base_root / "package.json")
    shutil.copy2(REPO_ROOT / ".worktreeinclude", base_root / ".worktreeinclude")
    shutil.copy2(REPO_ROOT / ".gitignore", base_root / ".gitignore")

    baseline = run_script(SKILL_CHECK, env={"LINKCV_REPO_ROOT": str(base_root)})
    assert baseline.returncode == 0, baseline.stderr

    for case_name, mutation, expected_error in cases:
        case_root = tmp_path / case_name
        shutil.copytree(base_root, case_root)

        if mutation == "required-marker":
            skill_file = (
                case_root / ".ai" / "skills" / "solution-generator" / "SKILL.md"
            )
            skill_file.write_text(
                skill_file.read_text(encoding="utf-8").replace(
                    "`solution.md` 是方案任务的唯一中心文档",
                    "方案文档只是可选参考",
                ),
                encoding="utf-8",
            )
        elif mutation in {"forbidden-marker", "forbidden-yml-marker"}:
            state_name = "state.yaml" if mutation == "forbidden-marker" else "state.yml"
            project_file = case_root / ".ai" / "prompts" / "project.md"
            project_file.write_text(
                project_file.read_text(encoding="utf-8")
                + f"\n重新读取 {state_name}。\n",
                encoding="utf-8",
            )
        elif mutation in {"template-status", "template-phase"}:
            field_name = "当前状态" if mutation == "template-status" else "当前阶段"
            template_file = (
                case_root
                / ".ai"
                / "skills"
                / "solution-generator"
                / "solution.template.md"
            )
            state_row = (
                f"| {field_name} | 实现中 |"
                if mutation == "template-status"
                else f"|**{field_name}**|实现中|"
            )
            template_file.write_text(
                template_file.read_text(encoding="utf-8")
                + f"\n{state_row}\n",
                encoding="utf-8",
            )
        elif mutation in {"legacy-script", "renamed-state-script"}:
            script_name = (
                "flow_guard.py" if mutation == "legacy-script" else "workflow.py"
            )
            legacy_script = case_root / "scripts" / "spec" / script_name
            legacy_script.parent.mkdir(parents=True)
            legacy_script.write_text("# legacy\n", encoding="utf-8")
        elif mutation in {"legacy-command", "renamed-state-command"}:
            package_file = case_root / "package.json"
            package = json.loads(package_file.read_text(encoding="utf-8"))
            if mutation == "legacy-command":
                package["scripts"]["spec"] = "python scripts/spec/flow_guard.py"
            else:
                package["scripts"]["workflow:state"] = (
                    "python scripts/spec/workflow.py"
                )
            package_file.write_text(
                json.dumps(package, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        elif mutation == "missing-ignore-rule":
            ignore_file = case_root / ".gitignore"
            ignore_file.write_text(
                ignore_file.read_text(encoding="utf-8").replace(".specs/*/\n", ""),
                encoding="utf-8",
            )
        else:
            include_file = case_root / ".worktreeinclude"
            include_file.write_text(
                include_file.read_text(encoding="utf-8").replace(
                    ".specs/*/", "# .specs/*/"
                ),
                encoding="utf-8",
            )

        result = run_script(SKILL_CHECK, env={"LINKCV_REPO_ROOT": str(case_root)})

        assert result.returncode == 1
        assert expected_error in result.stderr


def test_docs_sync_reports_missing_required_documents() -> None:
    result = run_script(
        DOCS_SYNC,
        "--files",
        "apps/backend/src/linkcv/api/routes/health.py",
    )

    assert result.returncode == 1
    assert "fastapi-http-contract" in result.stderr
    assert "docs/api/http-contracts.md" in result.stderr
    assert "docs/internals/backend.md" in result.stderr


def test_docs_sync_accepts_complete_companion_updates() -> None:
    result = run_script(
        DOCS_SYNC,
        "--files",
        "apps/backend/src/linkcv/api/routes/health.py",
        "docs/api/http-contracts.md",
        "docs/internals/backend.md",
    )

    assert result.returncode == 0, result.stderr


def test_runtime_contracts_match_current_repository() -> None:
    result = run_script(RUNTIME_CONTRACTS)

    assert result.returncode == 0, result.stderr
    assert "26 组运行时契约" in result.stdout


def test_runtime_contracts_report_drift(tmp_path: Path) -> None:
    rules = yaml.safe_load(RUNTIME_CONTRACT_RULES.read_text(encoding="utf-8"))
    target_rules = tmp_path / "scripts" / "quality" / "runtime-contract-rules.yaml"
    target_rules.parent.mkdir(parents=True)
    shutil.copy2(RUNTIME_CONTRACT_RULES, target_rules)

    for contract in rules["contracts"]:
        for assertion in contract["assertions"]:
            relative = Path(assertion["path"])
            target = tmp_path / relative
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(REPO_ROOT / relative, target)

    backend_config = (
        tmp_path / "apps" / "backend" / "src" / "linkcv" / "core" / "config.py"
    )
    backend_config.write_text(
        backend_config.read_text(encoding="utf-8").replace(
            'default=8000, alias="BACKEND_PORT"',
            'default=8010, alias="BACKEND_PORT"',
        ),
        encoding="utf-8",
    )

    result = run_script(
        RUNTIME_CONTRACTS,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert "fastapi-default-port" in result.stderr
    assert "apps/backend/src/linkcv/core/config.py" in result.stderr


def test_skill_check_rejects_unowned_ai_top_level_entry(tmp_path: Path) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "skills").mkdir(parents=True)
    (tmp_path / ".ai" / "references").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text(
        "rules", encoding="utf-8"
    )
    (tmp_path / ".ai" / "skills" / "README.md").write_text(
        "skills", encoding="utf-8"
    )

    result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert ".ai 顶层含未归属目录或文件" in result.stderr
    assert "长期知识应放 docs" in result.stderr


def test_skill_check_accepts_linkcv_backend_test_paths(tmp_path: Path) -> None:
    skill_root = tmp_path / ".ai" / "skills" / "test-authoring"
    skill_root.mkdir(parents=True)
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text(
        "rules", encoding="utf-8"
    )
    (tmp_path / ".ai" / "skills" / "README.md").write_text(
        "skills", encoding="utf-8"
    )
    (skill_root / "SKILL.md").write_text(
        """---
name: test-authoring
description: 为 LinkCV 后端单元和集成测试提供真实路径及清晰的触发条件说明，适用于需要补充测试覆盖或调整测试分层的请求。
---

测试放在 `apps/backend/tests/unit/` 和 `apps/backend/tests/integration/`。
""",
        encoding="utf-8",
    )

    result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 0, result.stderr


def test_skill_check_rejects_solution_template_without_required_capability(tmp_path: Path) -> None:
    protected_markers = (
        "### 1. 需求描述",
        "### 5. 状态机",
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
        "#### 9.3 代码实施计划",
        "### 14. 验证与验收",
    )

    for index, marker in enumerate(protected_markers):
        case_root = tmp_path / f"case-{index}"
        (case_root / ".ai" / "prompts").mkdir(parents=True)
        (case_root / ".ai" / "prompts" / "project.md").write_text(
            "rules", encoding="utf-8"
        )
        skills_root = case_root / ".ai" / "skills"
        skills_root.mkdir(parents=True)
        (skills_root / "README.md").write_text("skills", encoding="utf-8")
        source_skill = REPO_ROOT / ".ai" / "skills" / "solution-generator"
        target_skill = skills_root / "solution-generator"
        shutil.copytree(source_skill, target_skill)
        template_file = target_skill / "solution.template.md"
        template_file.write_text(
            template_file.read_text(encoding="utf-8").replace(
                marker, f"### 已删除能力 {index}"
            ),
            encoding="utf-8",
        )

        result = run_script(
            SKILL_CHECK,
            env={"LINKCV_REPO_ROOT": str(case_root)},
        )

        assert result.returncode == 1
        assert "方案模板缺少完整章节库或施工能力" in result.stderr
        assert marker in result.stderr


def test_skill_check_rejects_solution_skill_without_on_demand_contract(tmp_path: Path) -> None:
    protected_markers = (
        "未命中的章节整章删除",
        "必须保留状态机",
        "必须保留数据模型",
        "第 7 章固定按实际内容连续编号",
        "新增表和已有表的字段变化都使用 SQL 风格的结构定义片段",
        "不得混入“字段定义”或“新增字段”",
        "才保留“存量数据、兼容与迁移”",
        "存量数据处理使用正常文本描述",
        "没有 Issue 不阻止创建方案，也不算例外",
        "没有真实待决选择的短方案，整份展示一次并确认一次",
        "确认方案时直接复用该选择",
    )

    for index, marker in enumerate(protected_markers):
        case_root = tmp_path / f"case-{index}"
        (case_root / ".ai" / "prompts").mkdir(parents=True)
        (case_root / ".ai" / "prompts" / "project.md").write_text(
            "rules", encoding="utf-8"
        )
        skills_root = case_root / ".ai" / "skills"
        skills_root.mkdir(parents=True)
        (skills_root / "README.md").write_text("skills", encoding="utf-8")
        source_skill = REPO_ROOT / ".ai" / "skills" / "solution-generator"
        target_skill = skills_root / "solution-generator"
        shutil.copytree(source_skill, target_skill)
        skill_file = target_skill / "SKILL.md"
        skill_file.write_text(
            skill_file.read_text(encoding="utf-8").replace(
                marker,
                f"核心规则已删除 {index}",
            ),
            encoding="utf-8",
        )

        result = run_script(
            SKILL_CHECK,
            env={"LINKCV_REPO_ROOT": str(case_root)},
        )

        assert result.returncode == 1
        assert "方案生成规则缺少按需施工契约" in result.stderr
        assert marker in result.stderr


def test_skill_check_rejects_deprecated_solution_ddl_contract(tmp_path: Path) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text(
        "rules", encoding="utf-8"
    )
    skills_root = tmp_path / ".ai" / "skills"
    skills_root.mkdir(parents=True)
    (skills_root / "README.md").write_text("skills", encoding="utf-8")
    source_skill = REPO_ROOT / ".ai" / "skills" / "solution-generator"
    target_skill = skills_root / "solution-generator"
    shutil.copytree(source_skill, target_skill)
    template_file = target_skill / "solution.template.md"
    template_file.write_text(
        template_file.read_text(encoding="utf-8")
        + "\n#### 7.4 定稿 DDL\n\n```sql\nALTER TABLE example;\n```\n",
        encoding="utf-8",
    )

    result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert "方案模板仍包含旧的可执行 DDL 展示契约" in result.stderr
    assert "#### 7.4 定稿 DDL" in result.stderr


def test_skill_check_rejects_fixed_solution_section_in_downstream_skill(
    tmp_path: Path,
) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text(
        "rules", encoding="utf-8"
    )
    skills_root = tmp_path / ".ai" / "skills"
    skills_root.mkdir(parents=True)
    (skills_root / "README.md").write_text("skills", encoding="utf-8")
    for skill_name in ("solution-generator", "acceptance-generator"):
        shutil.copytree(
            REPO_ROOT / ".ai" / "skills" / skill_name,
            skills_root / skill_name,
        )
    skill_file = skills_root / "acceptance-generator" / "SKILL.md"
    skill_file.write_text(
        skill_file.read_text(encoding="utf-8")
        + "\n验证方式读取方案文档 9.3。\n",
        encoding="utf-8",
    )

    result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert "acceptance-generator: 方案流程规则仍依赖 solution.md 固定章节号" in result.stderr
    assert "方案文档 9.3" in result.stderr


def test_skill_check_rejects_incomplete_flow_router_contract(tmp_path: Path) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text(
        "rules", encoding="utf-8"
    )
    skills_root = tmp_path / ".ai" / "skills"
    skills_root.mkdir(parents=True)
    (skills_root / "README.md").write_text("skills", encoding="utf-8")
    source_skill = REPO_ROOT / ".ai" / "skills" / "flow-router"
    target_skill = skills_root / "flow-router"
    shutil.copytree(source_skill, target_skill)
    skill_file = target_skill / "SKILL.md"
    skill_file.write_text(
        skill_file.read_text(encoding="utf-8").replace(
            "用户明确给出的控制项必须原样传给下游",
            "用户控制项可以由入口重新选择",
        ),
        encoding="utf-8",
    )

    result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert "薄领域入口契约缺少必要内容" in result.stderr
    assert "用户明确给出的控制项必须原样传给下游" in result.stderr


def test_skill_check_protects_visual_frontend_delivery_contract(
    tmp_path: Path,
) -> None:
    protected_markers = (
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
        "`.specs/<KEY>/prototype/` 创建自包含的 `index.html`",
        "不新增依赖，不请求外部资源",
        "`imagegen` 只用于视觉探索",
        "只覆盖当前轮次的短交接",
        "继承真实应用壳，不自行发明导航、品牌或全局视觉语言",
        "主 Agent 在浏览器查看桌面或本轮受影响断点，并执行视觉拒收门禁",
        "确认前不得提交、推送或创建 PR",
        "每轮由 Luna 完成一个可回退的小步修改",
        "用户的下一句反馈直接开启下一轮",
        "不要每轮运行完整测试",
        "用户明确表示方向稳定、可以收口或要求交付",
    )

    for index, marker in enumerate(protected_markers):
        case_root = tmp_path / f"case-{index}"
        (case_root / ".ai" / "prompts").mkdir(parents=True)
        (case_root / ".ai" / "prompts" / "project.md").write_text(
            "rules", encoding="utf-8"
        )
        skills_root = case_root / ".ai" / "skills"
        skills_root.mkdir(parents=True)
        (skills_root / "README.md").write_text("skills", encoding="utf-8")
        source_skill = REPO_ROOT / ".ai" / "skills" / "frontend-delivery"
        target_skill = skills_root / "frontend-delivery"
        shutil.copytree(source_skill, target_skill)
        skill_file = target_skill / "SKILL.md"
        skill_file.write_text(
            skill_file.read_text(encoding="utf-8").replace(marker, "核心语义已删除"),
            encoding="utf-8",
        )

        result = run_script(
            SKILL_CHECK,
            env={"LINKCV_REPO_ROOT": str(case_root)},
        )

        assert result.returncode == 1
        assert "对话式可视设计契约缺少必要内容" in result.stderr
        assert marker in result.stderr


def test_skill_check_rejects_text_only_frontend_design_gate(tmp_path: Path) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text(
        "rules", encoding="utf-8"
    )
    skills_root = tmp_path / ".ai" / "skills"
    skills_root.mkdir(parents=True)
    (skills_root / "README.md").write_text("skills", encoding="utf-8")
    source_skill = REPO_ROOT / ".ai" / "skills" / "frontend-delivery"
    target_skill = skills_root / "frontend-delivery"
    shutil.copytree(source_skill, target_skill)
    skill_file = target_skill / "SKILL.md"
    skill_file.write_text(
        skill_file.read_text(encoding="utf-8")
        + "\n完整必须创建 `ui-design.md`。\n",
        encoding="utf-8",
    )

    result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert "仍存在一次性冻结设计的过期契约" in result.stderr


def test_skill_check_protects_backend_delivery_core_semantics(tmp_path: Path) -> None:
    protected_markers = (
        "七个维度仍必须在内部完整判断",
        "没有 Issue 不阻止七维判断或交付",
        "严格风险本身不自动升级为方案先行",
        "记录需要不改变交付路径",
        "记录为持久记录也不自动升级方案",
        "不要为方案路径再启动第二个 Sol 规划 Agent",
        "准备为`需澄清`或`需调查`",
        "只有准备不足、风险严格、需要持久记录或用户主动要求查看判断依据时",
        "`model`: `gpt-5.6-sol`",
        "`reasoning_effort`: `medium`",
        "`model`: `gpt-5.6-luna`",
        "`reasoning_effort`: `max`",
    )

    for index, marker in enumerate(protected_markers):
        case_root = tmp_path / f"case-{index}"
        (case_root / ".ai" / "prompts").mkdir(parents=True)
        (case_root / ".ai" / "prompts" / "project.md").write_text(
            "rules", encoding="utf-8"
        )
        skills_root = case_root / ".ai" / "skills"
        skills_root.mkdir(parents=True)
        (skills_root / "README.md").write_text("skills", encoding="utf-8")
        source_skill = REPO_ROOT / ".ai" / "skills" / "backend-delivery"
        target_skill = skills_root / "backend-delivery"
        shutil.copytree(source_skill, target_skill)
        skill_file = target_skill / "SKILL.md"
        skill_file.write_text(
            skill_file.read_text(encoding="utf-8").replace(marker, "核心语义已删除"),
            encoding="utf-8",
        )

        result = run_script(
            SKILL_CHECK,
            env={"LINKCV_REPO_ROOT": str(case_root)},
        )

        assert result.returncode == 1
        assert "七维判断、模型路由或回流契约缺少必要内容" in result.stderr
        assert marker in result.stderr


def test_skill_check_protects_five_reduction_contracts(tmp_path: Path) -> None:
    protected_cases = (
        (
            "module-planning",
            "SKILL.md",
            "没有 Issue 不阻塞模块规划",
        ),
        (
            "module-planning",
            "SKILL.md",
            "复用该授权，不再索要一遍相同指令",
        ),
        (
            "implementation-execution",
            "implementation_report.template.md",
            "## 2. 已接受限制",
        ),
        (
            "implementation-execution",
            "SKILL.md",
            "严格风险本身都不触发报告",
        ),
        (
            "run-all-tests",
            "SKILL.md",
            "**任务范围验证**",
        ),
        (
            "run-all-tests",
            "SKILL.md",
            "准备创建 PR 时始终运行完整 `npm run check`",
        ),
        (
            "branch-pr-workflow",
            "SKILL.md",
            "来源 Issue 是可选的追踪信息",
        ),
        (
            "code-review-and-quality",
            "SKILL.md",
            "不写入工作流状态",
        ),
    )

    for index, (skill_name, relative_file, marker) in enumerate(protected_cases):
        case_root = tmp_path / f"case-{index}"
        (case_root / ".ai" / "prompts").mkdir(parents=True)
        (case_root / ".ai" / "prompts" / "project.md").write_text(
            "rules", encoding="utf-8"
        )
        skills_root = case_root / ".ai" / "skills"
        skills_root.mkdir(parents=True)
        (skills_root / "README.md").write_text("skills", encoding="utf-8")
        shutil.copytree(
            REPO_ROOT / ".ai" / "skills" / skill_name,
            skills_root / skill_name,
        )
        protected_file = skills_root / skill_name / relative_file
        protected_file.write_text(
            protected_file.read_text(encoding="utf-8").replace(
                marker, f"减法契约已删除 {index}"
            ),
            encoding="utf-8",
        )

        result = run_script(
            SKILL_CHECK,
            env={"LINKCV_REPO_ROOT": str(case_root)},
        )

        assert result.returncode == 1
        assert "五项减法契约缺少必要内容" in result.stderr
        assert marker in result.stderr


def test_skill_check_protects_backend_delivery_downstream_contract(
    tmp_path: Path,
) -> None:
    protected_markers = (
        (
            "implementation-execution",
            "方案先行任务以当前 `solution.md` 为准；"
            "直接实现以来源材料、当前确认结论和 `backend-delivery` 七维简报列出的严格检查项为准",
            "实现入口或实施报告契约缺少必要内容",
        ),
        (
            "implementation-execution",
            "不因选择影响大就自动升级为模块规划",
            "实现入口或实施报告契约缺少必要内容",
        ),
        (
            "contract-guard",
            "已经明确属于方案先行的单需求分歧直接交 `solution-generator` 修订当前方案",
            "领域或七维回流契约缺少必要内容",
        ),
    )

    for index, (skill_name, marker, expected_error) in enumerate(protected_markers):
        case_root = tmp_path / f"case-{index}"
        (case_root / ".ai" / "prompts").mkdir(parents=True)
        (case_root / ".ai" / "prompts" / "project.md").write_text(
            "rules", encoding="utf-8"
        )
        skills_root = case_root / ".ai" / "skills"
        skills_root.mkdir(parents=True)
        (skills_root / "README.md").write_text("skills", encoding="utf-8")
        source_skill = REPO_ROOT / ".ai" / "skills" / skill_name
        target_skill = skills_root / skill_name
        shutil.copytree(source_skill, target_skill)
        skill_file = target_skill / "SKILL.md"
        skill_file.write_text(
            skill_file.read_text(encoding="utf-8").replace(marker, "核心语义已删除"),
            encoding="utf-8",
        )

        result = run_script(
            SKILL_CHECK,
            env={"LINKCV_REPO_ROOT": str(case_root)},
        )

        assert result.returncode == 1
        assert expected_error in result.stderr
        assert marker in result.stderr


def test_skill_check_protects_source_authority_and_one_way_delivery(
    tmp_path: Path,
) -> None:
    cases = (
            (
                Path(".ai/skills/README.md"),
                "飞书文档只作为方案或 UI 设计形成前的初始输入",
        ),
        (
            Path(".ai/skills/solution-generator/SKILL.md"),
            "把已确认的取舍和被替代的来源结论写入当前 `solution.md`",
        ),
        (
            Path(".ai/skills/implementation-execution/SKILL.md"),
            "飞书冲突本身不触发 `module-planning`",
        ),
            (
                Path(".specs/README.md"),
                "飞书只提供方案或视觉设计形成前的初始输入",
        ),
        (
            Path(".ai/prompts/project.md"),
            "需求和交付信息按单向链路流转",
        ),
        (
            Path(".ai/skills/README.md"),
            "| 跟踪收尾层 | 来源 Issue 的交付评论 |",
        ),
        (
            Path(".ai/skills/branch-pr-workflow/SKILL.md"),
            "同一业务需求默认只在 `dev` PR 创建后发布一条交付评论",
        ),
        (
            Path(".ai/skills/branch-pr-workflow/pull_request.template.md"),
            "## 来源差异与取舍",
        ),
        (
            Path(".ai/skills/branch-pr-workflow/issue_delivery_comment.template.md"),
            "重要差异：",
        ),
        (
            Path(".specs/README.md"),
            "PR 创建后只追加一条交付评论",
        ),
    )
    base_root = tmp_path / "base"
    (base_root / ".ai" / "prompts").mkdir(parents=True)
    (base_root / ".ai" / "skills").mkdir(parents=True)
    (base_root / ".specs").mkdir(parents=True)
    shutil.copy2(
        REPO_ROOT / ".ai" / "prompts" / "project.md",
        base_root / ".ai" / "prompts" / "project.md",
    )
    shutil.copy2(
        REPO_ROOT / ".ai" / "skills" / "README.md",
        base_root / ".ai" / "skills" / "README.md",
    )
    for skill_name in (
        "solution-generator",
        "implementation-execution",
        "branch-pr-workflow",
        "run-all-tests",
        "code-review-and-quality",
    ):
        shutil.copytree(
            REPO_ROOT / ".ai" / "skills" / skill_name,
            base_root / ".ai" / "skills" / skill_name,
        )
    shutil.copy2(
        REPO_ROOT / ".specs" / "README.md",
        base_root / ".specs" / "README.md",
    )
    shutil.copy2(REPO_ROOT / "package.json", base_root / "package.json")
    shutil.copy2(REPO_ROOT / ".worktreeinclude", base_root / ".worktreeinclude")
    shutil.copy2(REPO_ROOT / ".gitignore", base_root / ".gitignore")

    baseline = run_script(SKILL_CHECK, env={"LINKCV_REPO_ROOT": str(base_root)})
    assert baseline.returncode == 0, baseline.stderr

    for index, (relative_path, marker) in enumerate(cases):
        case_root = tmp_path / f"required-{index}"
        shutil.copytree(base_root, case_root)
        target = case_root / relative_path
        target.write_text(
            target.read_text(encoding="utf-8").replace(marker, "来源优先级规则已删除"),
            encoding="utf-8",
        )

        result = run_script(SKILL_CHECK, env={"LINKCV_REPO_ROOT": str(case_root)})

        assert result.returncode == 1
        assert "单向交付契约缺少必要内容" in result.stderr
        assert marker in result.stderr

    legacy_root = tmp_path / "legacy-feishu-priority"
    shutil.copytree(base_root, legacy_root)
    legacy_solution = (
        legacy_root / ".ai" / "skills" / "solution-generator" / "SKILL.md"
    )
    legacy_solution.write_text(
        legacy_solution.read_text(encoding="utf-8")
        + "\n其已确认结论优先于本地推断。\n",
        encoding="utf-8",
    )

    legacy_result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(legacy_root)},
    )

    assert legacy_result.returncode == 1
    assert "仍含旧的并行来源或禁止收尾规则" in legacy_result.stderr
    assert "其已确认结论优先于本地推断" in legacy_result.stderr

    old_rule_root = tmp_path / "legacy-no-issue-closeout"
    shutil.copytree(base_root, old_rule_root)
    old_readme = old_rule_root / ".ai" / "skills" / "README.md"
    old_readme.write_text(
        old_readme.read_text(encoding="utf-8")
        + "\n也不向任何 Issue 系统写回评论。\n",
        encoding="utf-8",
    )

    old_rule_result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(old_rule_root)},
    )

    assert old_rule_result.returncode == 1
    assert "仍含旧的并行来源或禁止收尾规则" in old_rule_result.stderr


def test_skill_check_rejects_legacy_flow_router_rule(tmp_path: Path) -> None:
    (tmp_path / ".ai" / "prompts").mkdir(parents=True)
    (tmp_path / ".ai" / "prompts" / "project.md").write_text(
        "rules", encoding="utf-8"
    )
    skills_root = tmp_path / ".ai" / "skills"
    skills_root.mkdir(parents=True)
    (skills_root / "README.md").write_text("skills", encoding="utf-8")
    source_skill = REPO_ROOT / ".ai" / "skills" / "flow-router"
    target_skill = skills_root / "flow-router"
    shutil.copytree(source_skill, target_skill)
    skill_file = target_skill / "SKILL.md"
    skill_file.write_text(
        skill_file.read_text(encoding="utf-8")
        + "\n任意一条不满足即判方案先行。\n",
        encoding="utf-8",
    )

    result = run_script(
        SKILL_CHECK,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert "仍含应由 backend-delivery 拥有的路径判断" in result.stderr
