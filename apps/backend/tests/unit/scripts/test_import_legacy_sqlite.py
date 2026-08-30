import importlib.util
import json
import sqlite3
import sys
from pathlib import Path
from types import ModuleType

import bcrypt
import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

import linkcv.models  # noqa: F401
from linkcv.core.database import Base
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import Resume, ResumeTemplate, ResumeVersion

REPO_ROOT = Path(__file__).resolve().parents[5]


def load_importer() -> ModuleType:
    path = REPO_ROOT / "apps/backend/scripts/release/import_legacy_sqlite.py"
    spec = importlib.util.spec_from_file_location("linkcv_legacy_sqlite_import_test", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def create_legacy_database(path: Path, *, markdown: str = "# 张三\n\n正文") -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE resumes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          markdown TEXT NOT NULL,
          settings_json TEXT NOT NULL,
          split_ratio REAL NOT NULL,
          preview_scale REAL NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """
    )
    password_hash = bcrypt.hashpw(
        b"legacy-password", bcrypt.gensalt(rounds=4)
    ).decode("ascii")
    timestamp = "2026-08-20T08:00:00Z"
    connection.execute(
        "INSERT INTO users VALUES (?, ?, ?, ?, ?)",
        ("user_old", "Example@Example.com", password_hash, timestamp, timestamp),
    )
    connection.execute(
        "INSERT INTO sessions VALUES (?, ?, ?, ?)",
        ("session_old", "user_old", "2026-09-20T08:00:00Z", timestamp),
    )
    settings = json.dumps(
        {
            "fontFamily": "source-han-serif",
            "fontSize": 10.5,
            "lineHeight": 1.32,
            "pageMargin": 16,
            "verticalPageMargin": 14,
            "theme": "classic",
            "smartOnePage": False,
            "showSource": False,
        }
    )
    connection.execute(
        "INSERT INTO resumes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "resume_old",
            "user_old",
            "旧简历",
            markdown,
            settings,
            0.4,
            1.0,
            timestamp,
            timestamp,
        ),
    )
    connection.commit()
    connection.close()


def create_target_engine():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return engine


def test_dry_run_then_execute_imports_users_resumes_and_initial_versions(
    tmp_path: Path,
) -> None:
    module = load_importer()
    source = tmp_path / "legacy.sqlite"
    create_legacy_database(source)
    plan = module.build_import_plan(source)
    engine = create_target_engine()

    module.import_plan(engine, plan, execute=False)
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 0

    module.import_plan(engine, plan, execute=True)
    with Session(engine) as session:
        user = session.scalar(select(User))
        resume = session.scalar(select(Resume))
        template = session.scalar(select(ResumeTemplate))
        version = session.scalar(select(ResumeVersion))
        assert user is not None
        assert user.email == "example@example.com"
        assert user.nickname == "example"
        assert user.password_hash.startswith("$2")
        assert resume is not None
        assert resume.user_id == user.id
        assert resume.source_type == "blank"
        assert resume.data_json["schema_version"] == "canonical-resume.v1"
        assert template is not None
        assert resume.template_id == template.id
        assert version is not None
        assert version.resume_id == resume.id
        assert version.template_id == template.id
        assert version.name == "初始版本"
        assert plan.skipped_sessions == 1

    with pytest.raises(RuntimeError, match="empty target business tables"):
        module.import_plan(engine, plan, execute=True)


def test_invalid_legacy_markdown_is_rejected_before_target_writes(
    tmp_path: Path,
) -> None:
    module = load_importer()
    source = tmp_path / "legacy.sqlite"
    create_legacy_database(source, markdown="# 张三\n\n<script>alert(1)</script>")

    with pytest.raises(RuntimeError, match="legacy resume record 1 is invalid"):
        module.build_import_plan(source)
