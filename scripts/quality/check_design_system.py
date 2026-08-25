#!/usr/bin/env python3
"""Validate the machine-readable LinkCV design contract and Settings Pattern."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import yaml


REPO_ROOT = Path(
    os.environ.get("LINKCV_REPO_ROOT", Path(__file__).resolve().parents[2])
).resolve()
DESIGN_FILE = REPO_ROOT / "DESIGN.md"
TOKENS_FILE = REPO_ROOT / "apps" / "web" / "src" / "design-system" / "tokens.css"
LAYOUT_PATTERNS_CSS_FILE = REPO_ROOT / "apps" / "web" / "src" / "components" / "ui" / "layout-patterns.css"

REQUIRED_SETTINGS_TOKENS = (
    "--ui-settings-content-max",
    "--ui-settings-section-inset",
    "--ui-settings-row-min-size",
    "--ui-settings-action-track",
    "--ui-settings-label-track",
)


def read_design_frontmatter(path: Path) -> dict[str, object]:
    if not path.is_file():
        raise ValueError(f"缺少设计事实源：{path.relative_to(REPO_ROOT)}")
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError("DESIGN.md 必须以 YAML frontmatter 开始")
    _, frontmatter, _ = text.split("---\n", 2)
    data = yaml.safe_load(frontmatter) or {}
    if not isinstance(data, dict):
        raise ValueError("DESIGN.md frontmatter 必须是对象")
    return data


def load_settings_contract(path: Path) -> dict[str, str]:
    data = read_design_frontmatter(path)
    pattern = data.get("settingsPattern")
    if not isinstance(pattern, dict):
        raise ValueError("DESIGN.md 缺少 machine-readable settingsPattern")
    contract = pattern.get("tokenContract")
    if not isinstance(contract, dict):
        raise ValueError("settingsPattern 缺少 tokenContract")

    errors: list[str] = []
    values: dict[str, str] = {}
    for token in REQUIRED_SETTINGS_TOKENS:
        value = contract.get(token)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"settingsPattern.tokenContract 缺少 {token}")
        else:
            values[token] = value.strip()
    if errors:
        raise ValueError("；".join(errors))
    return values


def parse_token_declarations(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise ValueError(f"缺少运行时 Token 文件：{path.relative_to(REPO_ROOT)}")
    text = path.read_text(encoding="utf-8")
    return {
        name: value.strip()
        for name, value in re.findall(r"^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);", text, re.MULTILINE)
    }


def normalize_css_value(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def extract_css_blocks(text: str) -> list[tuple[str, str]]:
    """Extract selector/body pairs without interpreting unrelated CSS geometry."""
    blocks: list[tuple[str, str]] = []
    stack: list[list[object]] = []
    last_boundary = 0
    for index, char in enumerate(text):
        if char == "{":
            start = int(stack[-1][2]) if stack else last_boundary
            selector = re.sub(r"/\*.*?\*/", "", text[start:index], flags=re.DOTALL).strip()
            stack.append([selector, index, index + 1])
        elif char == "}" and stack:
            selector, start, _ = stack.pop()
            blocks.append((str(selector), text[int(start) + 1 : index]))
            if stack:
                stack[-1][2] = index + 1
            else:
                last_boundary = index + 1
    return blocks


def declarations(body: str) -> dict[str, str]:
    return {
        name: normalize_css_value(value)
        for name, value in re.findall(r"([a-z-]+)\s*:\s*([^;{}]+);", body)
    }


def collect_properties(text: str, selector: str, property_name: str) -> list[str]:
    values: list[str] = []
    for block_selector, body in extract_css_blocks(text):
        if block_selector.strip() != selector:
            continue
        value = declarations(body).get(property_name)
        if value is not None:
            values.append(value)
    return values


def require_property(
    errors: list[str],
    css: str,
    selector: str,
    property_name: str,
    expected: str,
    label: str,
) -> None:
    values = collect_properties(css, selector, property_name)
    if normalize_css_value(expected) not in values:
        actual = ", ".join(values) if values else "未找到"
        errors.append(f"{label}: {selector} 的 {property_name} 应为 {expected}，实际为 {actual}")


def require_only_values(
    errors: list[str],
    css: str,
    selector: str,
    property_name: str,
    allowed: set[str],
    label: str,
) -> None:
    actual = set(collect_properties(css, selector, property_name))
    unexpected = sorted(actual - {normalize_css_value(value) for value in allowed})
    if unexpected:
        errors.append(
            f"{label}: {selector} 的 {property_name} 含未映射值 {', '.join(unexpected)}"
        )


def check_settings_css(paths: tuple[Path, ...]) -> list[str]:
    errors: list[str] = []
    chunks: list[str] = []
    for path in paths:
        if not path.is_file():
            errors.append(f"缺少设计布局实现：{path.relative_to(REPO_ROOT)}")
            continue
        chunks.append(path.read_text(encoding="utf-8"))
    if errors:
        return errors
    css = "\n".join(chunks)

    require_property(
        errors,
        css,
        ".ui-settings-layout",
        "width",
        "min(var(--ui-settings-content-max), 100%)",
        "Settings Pattern 内容宽度",
    )
    for property_name, expected in (
        ("border", "1px solid var(--ui-border)"),
        ("border-radius", "var(--ui-radius-lg)"),
        ("background", "var(--ui-surface)"),
    ):
        require_property(
            errors,
            css,
            ".ui-settings-layout--framed",
            property_name,
            expected,
            "Settings Pattern 外框",
        )
    require_property(
        errors,
        css,
        ".ui-settings-section",
        "padding",
        "var(--ui-settings-section-inset)",
        "Settings Pattern section inset",
    )
    require_property(
        errors,
        css,
        ".ui-settings-section",
        "padding",
        "var(--ui-space-4)",
        "Settings Pattern 移动 section inset",
    )
    require_property(
        errors,
        css,
        ".ui-settings-row",
        "grid-template-columns",
        "var(--ui-settings-label-track) minmax(0, 1fr) var(--ui-settings-action-track)",
        "Settings Pattern 桌面三列",
    )
    require_property(
        errors,
        css,
        ".ui-settings-row",
        "grid-template-columns",
        "1fr",
        "Settings Pattern 移动单列",
    )
    require_property(
        errors,
        css,
        ".ui-settings-row",
        "column-gap",
        "var(--ui-space-3)",
        "Settings Pattern 桌面列间距",
    )
    require_property(
        errors,
        css,
        ".ui-settings-row",
        "min-height",
        "var(--ui-settings-row-min-size)",
        "Settings Pattern 行最小高度",
    )
    for selector, property_name, allowed, label in (
        (
            ".ui-settings-section",
            "padding",
            {"var(--ui-settings-section-inset)", "var(--ui-space-4)"},
            "Settings Pattern section inset",
        ),
        (
            ".ui-settings-row",
            "grid-template-columns",
            {
                "var(--ui-settings-label-track) minmax(0, 1fr) var(--ui-settings-action-track)",
                "1fr",
            },
            "Settings Pattern 字段列",
        ),
        (
            ".ui-settings-row",
            "column-gap",
            {"var(--ui-space-3)"},
            "Settings Pattern 桌面列间距",
        ),
        (
            ".ui-settings-row",
            "min-height",
            {"var(--ui-settings-row-min-size)"},
            "Settings Pattern 行高度",
        ),
    ):
        require_only_values(errors, css, selector, property_name, allowed, label)
    return errors


def main() -> int:
    try:
        contract = load_settings_contract(DESIGN_FILE)
        runtime_tokens = parse_token_declarations(TOKENS_FILE)
        errors = [
            f"运行时 Token {token} 应为 {expected}，实际为 {runtime_tokens.get(token, '未定义')}"
            for token, expected in contract.items()
            if runtime_tokens.get(token) != expected
        ]
        errors.extend(check_settings_css((LAYOUT_PATTERNS_CSS_FILE,)))
    except (OSError, ValueError, yaml.YAMLError) as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        return 2

    if errors:
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        return 1

    print(
        "OK  已校验 DESIGN.md Settings Pattern、5 个运行时 Token 和共享布局 Pattern"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
