from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[4]
FLOW_GUARD = REPO_ROOT / "scripts" / "spec" / "flow_guard.py"
LINK_SETUP = REPO_ROOT / "scripts" / "setup" / "setup_ai_links.py"
SKILL_CHECK = REPO_ROOT / "scripts" / "quality" / "check_skills.py"
DOCS_SYNC = REPO_ROOT / "scripts" / "quality" / "check_docs_sync.py"
RUNTIME_CONTRACTS = REPO_ROOT / "scripts" / "quality" / "check_runtime_contracts.py"
RUNTIME_CONTRACT_RULES = REPO_ROOT / "scripts" / "quality" / "runtime-contract-rules.yaml"


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


def test_l3_flow_requires_frozen_artifacts_and_detects_drift(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(FLOW_GUARD, "init", "LCV-99", "--lane", "L3", env=env)
    blocked = run_script(FLOW_GUARD, "check", "LCV-99", "acceptance", env=env)
    assert initialized.returncode == 0, initialized.stderr
    assert blocked.returncode == 1
    assert "brief 尚未冻结" in blocked.stderr

    brief = specs_root / "LCV-99" / "brief.md"
    brief.write_text("# Brief\n", encoding="utf-8")
    frozen = run_script(FLOW_GUARD, "freeze", "LCV-99", "brief", env=env)
    allowed = run_script(FLOW_GUARD, "check", "LCV-99", "acceptance", env=env)
    assert frozen.returncode == 0, frozen.stderr
    assert allowed.returncode == 0, allowed.stderr

    brief.write_text("# Changed Brief\n", encoding="utf-8")
    drifted = run_script(FLOW_GUARD, "check", "LCV-99", "acceptance", env=env)
    assert drifted.returncode == 1
    assert "冻结后已变化" in drifted.stderr


def test_flow_init_records_manual_source_by_default(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(FLOW_GUARD, "init", "LCV-101", "--lane", "L2", env=env)
    state = yaml.safe_load((specs_root / "LCV-101" / "state.yaml").read_text(encoding="utf-8"))

    assert initialized.returncode == 0, initialized.stderr
    assert state["source"]["system"] == "manual"
    assert state["source"]["issue_id"] is None


def test_flow_init_records_explicit_external_source(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(
        FLOW_GUARD,
        "init",
        "LCV-102",
        "--lane",
        "L3",
        "--source-system",
        "multica",
        "--issue-id",
        "issue-102",
        env=env,
    )
    state = yaml.safe_load((specs_root / "LCV-102" / "state.yaml").read_text(encoding="utf-8"))
    status = run_script(FLOW_GUARD, "status", "LCV-102", env=env)

    assert initialized.returncode == 0, initialized.stderr
    assert state["source"]["system"] == "multica"
    assert state["source"]["issue_id"] == "issue-102"
    assert "source=multica" in status.stdout


def test_flow_init_rejects_external_source_without_issue_id(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    initialized = run_script(
        FLOW_GUARD,
        "init",
        "LCV-103",
        "--lane",
        "L2",
        "--source-system",
        "github",
        env=env,
    )

    assert initialized.returncode == 2
    assert "必须提供 --issue-id" in initialized.stderr
    assert not (specs_root / "LCV-103" / "state.yaml").exists()


def test_l2_flow_skips_technical_design_and_records_evidence(tmp_path: Path) -> None:
    specs_root = tmp_path / ".specs"
    feature = specs_root / "LCV-100"
    env = {"LINKCV_SPECS_ROOT": str(specs_root)}

    assert run_script(FLOW_GUARD, "init", "LCV-100", "--lane", "L2", env=env).returncode == 0
    (feature / "brief.md").write_text("brief", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-100", "brief", env=env).returncode == 0
    (feature / "acceptance.feature").write_text("Feature: saved", encoding="utf-8")
    assert run_script(FLOW_GUARD, "freeze", "LCV-100", "acceptance", env=env).returncode == 0

    implementation = run_script(FLOW_GUARD, "check", "LCV-100", "implementation", env=env)
    verified = run_script(
        FLOW_GUARD,
        "verify",
        "LCV-100",
        "--evidence",
        "npm run check",
        env=env,
    )
    done = run_script(FLOW_GUARD, "check", "LCV-100", "done", env=env)

    assert implementation.returncode == 0, implementation.stderr
    assert verified.returncode == 0, verified.stderr
    assert done.returncode == 0, done.stderr


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
    assert "4 组运行时契约" in result.stdout


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

    package_file = tmp_path / "package.json"
    package_file.write_text(
        package_file.read_text(encoding="utf-8").replace(
            "BACKEND_PORT:-8000", "BACKEND_PORT:-8010"
        ),
        encoding="utf-8",
    )

    result = run_script(
        RUNTIME_CONTRACTS,
        env={"LINKCV_REPO_ROOT": str(tmp_path)},
    )

    assert result.returncode == 1
    assert "fastapi-default-port" in result.stderr
    assert "package.json" in result.stderr


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
