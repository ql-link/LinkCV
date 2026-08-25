from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
DESIGN_CHECK = REPO_ROOT / "scripts" / "quality" / "check_design_system.py"
DESIGN_INPUTS = (
    Path("DESIGN.md"),
    Path("apps/web/src/design-system/tokens.css"),
    Path("apps/web/src/components/ui/layout-patterns.css"),
)


def run_check(repo_root: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["LINKCV_REPO_ROOT"] = str(repo_root)
    return subprocess.run(
        [sys.executable, str(DESIGN_CHECK)],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def copy_design_inputs(tmp_path: Path) -> None:
    for relative_path in DESIGN_INPUTS:
        target = tmp_path / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO_ROOT / relative_path, target)


def test_design_system_matches_settings_pattern() -> None:
    result = run_check(REPO_ROOT)

    assert result.returncode == 0, result.stderr
    assert "5 个运行时 Token" in result.stdout
    assert "共享布局 Pattern" in result.stdout


def test_design_system_rejects_runtime_token_drift(tmp_path: Path) -> None:
    copy_design_inputs(tmp_path)
    token_file = tmp_path / "apps/web/src/design-system/tokens.css"
    token_file.write_text(
        token_file.read_text(encoding="utf-8").replace(
            "--ui-settings-row-min-size: 3.5rem;",
            "--ui-settings-row-min-size: 3rem;",
        ),
        encoding="utf-8",
    )

    result = run_check(tmp_path)

    assert result.returncode == 1
    assert "--ui-settings-row-min-size" in result.stderr


def test_design_system_rejects_shared_pattern_drift(tmp_path: Path) -> None:
    copy_design_inputs(tmp_path)
    css_file = tmp_path / "apps/web/src/components/ui/layout-patterns.css"
    css_file.write_text(
        css_file.read_text(encoding="utf-8").replace(
            "grid-template-columns: var(--ui-settings-label-track) minmax(0, 1fr) var(--ui-settings-action-track);",
            "grid-template-columns: 156px minmax(0, 1fr) var(--ui-settings-action-track);",
        ),
        encoding="utf-8",
    )

    result = run_check(tmp_path)

    assert result.returncode == 1
    assert "Settings Pattern 桌面三列" in result.stderr


def test_design_system_rejects_shared_frame_drift(tmp_path: Path) -> None:
    copy_design_inputs(tmp_path)
    css_file = tmp_path / "apps/web/src/components/ui/layout-patterns.css"
    css_file.write_text(
        css_file.read_text(encoding="utf-8").replace(
            ".ui-settings-layout--framed {\n  overflow: hidden;\n  border: 1px solid var(--ui-border);\n  border-radius: var(--ui-radius-lg);",
            ".ui-settings-layout--framed {\n  overflow: hidden;\n  border: 1px solid var(--ui-border);\n  border-radius: 18px;",
            1,
        ),
        encoding="utf-8",
    )

    result = run_check(tmp_path)

    assert result.returncode == 1
    assert "Settings Pattern 外框" in result.stderr
