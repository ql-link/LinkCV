from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[5]
SQL_DIR = REPO_ROOT / "apps/backend/migrations/sql"

TEMPLATE_KEYS = (
    "administrative-sidebar-cn",
    "campus-professional-cn",
    "civic-service-cn",
    "creative-orange-cn",
)


def test_0026_seeds_four_guarded_fictional_templates() -> None:
    up_sql = (SQL_DIR / "0026.up.sql").read_text()

    for template_key in TEMPLATE_KEYS:
        assert up_sql.count(f"'{template_key}'") >= 2
    assert "ON DUPLICATE KEY UPDATE" in up_sql
    assert "data_json = VALUES(data_json)" in up_sql
    assert "style_json = VALUES(style_json)" in up_sql
    assert "张三" in up_sql
    assert "zhangsan@example.com" in up_sql
    assert ":::: sidebar" in up_sql
    assert ":::: meta" in up_sql
    assert ":::: trio" in up_sql
    assert ":icon[GraduationCap]:" in up_sql

    for rejected_source_value in (
        "韩跑跑",
        "小新",
        "codecv@163.com",
        "codecvcv@163.com",
        "华东师范大学",
        "江西财经大学",
        "北京大学",
        "清华大学",
        "阿里巴巴集团",
        "字节跳动",
        "中共党员",
        "爱好是看美女",
    ):
        assert rejected_source_value not in up_sql


def test_0026_refuses_to_delete_referenced_templates() -> None:
    down_sql = (SQL_DIR / "0026.down.sql").read_text()

    assert "FROM resumes AS resume" in down_sql
    assert "resume.template_id = template.id" in down_sql
    assert "NULL" in down_sql
    for template_key in TEMPLATE_KEYS:
        assert template_key in down_sql
