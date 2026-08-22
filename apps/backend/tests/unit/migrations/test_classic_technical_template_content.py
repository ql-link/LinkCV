from __future__ import annotations

import hashlib
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[5]
SQL_DIR = REPO_ROOT / "apps" / "backend" / "migrations" / "sql"


def _updated_markdown(sql: str) -> str:
    match = re.search(
        r"content\.content', '(# 张三.*)'\n  \),",
        sql,
        flags=re.DOTALL,
    )
    assert match is not None
    return match.group(1)


def _seeded_markdown(sql: str) -> str:
    match = re.search(
        r"'content', '(# 张三.*)'\n              \),",
        sql,
        flags=re.DOTALL,
    )
    assert match is not None
    return match.group(1)


def test_classic_technical_template_uses_independent_fictional_content() -> None:
    markdown = _updated_markdown((SQL_DIR / "0025.up.sql").read_text())

    assert "北辰科技大学" in markdown
    assert "极昼气象服务有限公司" in markdown
    assert "弦月创意工具有限公司" in markdown
    assert "TraceHarbor" in markdown
    assert "OpenTelemetry" in markdown

    for rejected_sample in (
        "星河云科技有限公司",
        "KnowledgeFlow",
        "销售预测",
        "知识检索",
        "AI 编程工具",
        "JMM",
        "Qdrant",
    ):
        assert rejected_sample not in markdown


def test_classic_technical_template_upgrade_guard_matches_0024_content() -> None:
    seed_sql = (SQL_DIR / "0024.up.sql").read_text()
    update_sql = (SQL_DIR / "0025.up.sql").read_text()
    seeded_digest = hashlib.sha256(_seeded_markdown(seed_sql).encode()).hexdigest()

    assert seeded_digest in update_sql
    assert "$.basics.headline')) <=> '后端开发工程师'" in update_sql
    assert "$.basics.location')) <=> '杭州'" in update_sql


def test_classic_technical_template_downgrade_guard_matches_new_content() -> None:
    up_sql = (SQL_DIR / "0025.up.sql").read_text()
    down_sql = (SQL_DIR / "0025.down.sql").read_text()
    markdown_digest = hashlib.sha256(_updated_markdown(up_sql).encode()).hexdigest()

    assert markdown_digest in down_sql
    assert "$.basics.headline')) <=> '平台工程师'" in down_sql
    assert "$.basics.location')) <=> '成都'" in down_sql
