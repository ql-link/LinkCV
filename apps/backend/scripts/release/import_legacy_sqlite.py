#!/usr/bin/env python3
"""Validate and import the legacy Production SQLite database into MySQL."""

from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import linkcv.models  # noqa: F401  # Register every mapped model.
from linkcv.core.config import load_settings
from linkcv.core.database import build_engine
from linkcv.domain.resume_document import ResumeDocumentV1
from linkcv.domain.resume_snapshot import ResumeSnapshot
from linkcv.domain.resume_style import ResumeStyleV1
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import Resume, ResumeVersion

LEGACY_SETTING_KEYS = {
    "fontFamily",
    "fontSize",
    "lineHeight",
    "pageMargin",
    "verticalPageMargin",
    "theme",
    "smartOnePage",
    "showSource",
}
BCRYPT_PREFIXES = ("$2a$", "$2b$", "$2y$")


@dataclass(frozen=True)
class LegacyUser:
    legacy_id: str
    email: str
    password_hash: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class LegacyResume:
    legacy_user_id: str
    title: str
    data: dict[str, Any]
    style: dict[str, Any]
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ImportPlan:
    users: tuple[LegacyUser, ...]
    resumes: tuple[LegacyResume, ...]
    skipped_sessions: int


def _parse_datetime(value: object, *, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"{field} must be a timestamp")
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        try:
            parsed = datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            raise RuntimeError(f"{field} must be an ISO timestamp") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _number(
    value: object, *, field: str, default: float, minimum: float, maximum: float
) -> float:
    if value is None:
        value = default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RuntimeError(f"{field} must be numeric")
    result = float(value)
    if not math.isfinite(result) or not minimum <= result <= maximum:
        raise RuntimeError(f"{field} is outside the supported range")
    return result


def _legacy_document(markdown: object) -> dict[str, Any]:
    if not isinstance(markdown, str):
        raise RuntimeError("legacy markdown must be text")
    heading = re.search(r"^#\s+(.+)$", markdown, re.MULTILINE)
    name = heading.group(1).strip() if heading else "张三"
    document = {
        "schema_version": "1.0",
        "basics": {
            "name": name,
            "headline": None,
            "email": None,
            "phone": None,
            "location": None,
            "photo": None,
            "summary": None,
            "links": [],
        },
        "sections": {
            "work_experiences": [],
            "educations": [],
            "projects": [],
            "skills": [],
            "certificates": [],
            "awards": [],
            "languages": [],
            "custom_sections": [
                {
                    "id": "custom_section_legacy",
                    "title": "简历正文",
                    "items": [
                        {
                            "id": "custom_item_legacy",
                            "title": None,
                            "subtitle": None,
                            "content": {"format": "markdown", "content": markdown},
                            "source_refs": [],
                        }
                    ],
                }
            ],
        },
    }
    try:
        return ResumeDocumentV1.model_validate(document).model_dump(mode="json")
    except ValueError:
        raise RuntimeError("legacy markdown cannot be converted safely") from None


def _legacy_style(
    settings_json: object, *, split_ratio: object, preview_scale: object
) -> dict[str, Any]:
    if not isinstance(settings_json, str):
        raise RuntimeError("legacy settings must be JSON text")
    try:
        settings = json.loads(settings_json)
    except json.JSONDecodeError:
        raise RuntimeError("legacy settings are not valid JSON") from None
    if not isinstance(settings, dict):
        raise RuntimeError("legacy settings must be a JSON object")
    unexpected = sorted(set(settings) - LEGACY_SETTING_KEYS)
    if unexpected:
        raise RuntimeError("legacy settings contain unsupported keys")

    theme = settings.get("theme", "classic")
    if theme not in {"classic", "modern", "compact"}:
        raise RuntimeError("legacy theme is unsupported")
    font_family = settings.get("fontFamily", "source-han-serif")
    if not isinstance(font_family, str) or not font_family:
        raise RuntimeError("legacy font family is invalid")
    if "Source Han Serif" in font_family:
        font_family = "source-han-serif"
    smart_one_page = settings.get("smartOnePage", False)
    if not isinstance(smart_one_page, bool):
        raise RuntimeError("legacy smartOnePage must be boolean")

    # These layout values no longer have direct fields, but invalid values must
    # still block import instead of being silently discarded.
    _number(split_ratio, field="legacy split_ratio", default=0.4, minimum=0.1, maximum=0.9)
    _number(
        preview_scale,
        field="legacy preview_scale",
        default=1.0,
        minimum=0.1,
        maximum=5.0,
    )
    horizontal_margin = _number(
        settings.get("pageMargin"),
        field="legacy pageMargin",
        default=16,
        minimum=0,
        maximum=50,
    )
    vertical_margin = _number(
        settings.get("verticalPageMargin"),
        field="legacy verticalPageMargin",
        default=16,
        minimum=0,
        maximum=50,
    )
    style = {
        "schema_version": "1.0",
        "template_key": f"{theme}-cn",
        "font_family": font_family,
        "font_size": _number(
            settings.get("fontSize"),
            field="legacy fontSize",
            default=10.5,
            minimum=6,
            maximum=32,
        ),
        "line_height": _number(
            settings.get("lineHeight"),
            field="legacy lineHeight",
            default=1.32,
            minimum=1,
            maximum=3,
        ),
        "accent_color": "#2F4858",
        "smart_one_page": smart_one_page,
        "page": {
            "size": "A4",
            "margin_top_mm": vertical_margin,
            "margin_right_mm": horizontal_margin,
            "margin_bottom_mm": vertical_margin,
            "margin_left_mm": horizontal_margin,
        },
        "section_order": ["basics", "custom_sections"],
    }
    try:
        return ResumeStyleV1.model_validate(style).model_dump(mode="json")
    except ValueError:
        raise RuntimeError("legacy style cannot be converted safely") from None


def _open_source(source: Path) -> sqlite3.Connection:
    if not source.is_file():
        raise RuntimeError("legacy SQLite source does not exist")
    connection = sqlite3.connect(
        f"file:{source.resolve()}?mode=ro&immutable=1", uri=True
    )
    connection.row_factory = sqlite3.Row
    return connection


def build_import_plan(source: Path) -> ImportPlan:
    with _open_source(source) as connection:
        users_raw = connection.execute(
            "SELECT id, email, password_hash, created_at, updated_at "
            "FROM users ORDER BY id"
        ).fetchall()
        resumes_raw = connection.execute(
            "SELECT user_id, title, markdown, settings_json, split_ratio, "
            "preview_scale, created_at, updated_at FROM resumes ORDER BY id"
        ).fetchall()
        skipped_sessions = int(
            connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        )

    if not users_raw:
        raise RuntimeError("legacy SQLite contains no users")
    legacy_ids: set[str] = set()
    users: list[LegacyUser] = []
    for index, row in enumerate(users_raw, start=1):
        try:
            legacy_id = row["id"]
            email = row["email"]
            password_hash = row["password_hash"]
            if not isinstance(legacy_id, str) or not legacy_id:
                raise RuntimeError("legacy user id is invalid")
            if legacy_id in legacy_ids:
                raise RuntimeError("legacy user ids are not unique")
            if not isinstance(email, str) or not email.strip() or len(email) > 254:
                raise RuntimeError("legacy user email is invalid")
            if (
                not isinstance(password_hash, str)
                or len(password_hash) != 60
                or not password_hash.startswith(BCRYPT_PREFIXES)
            ):
                raise RuntimeError("legacy password hash is not bcrypt")
            legacy_ids.add(legacy_id)
            users.append(
                LegacyUser(
                    legacy_id=legacy_id,
                    email=email.strip().lower(),
                    password_hash=password_hash,
                    created_at=_parse_datetime(
                        row["created_at"], field="legacy user created_at"
                    ),
                    updated_at=_parse_datetime(
                        row["updated_at"], field="legacy user updated_at"
                    ),
                )
            )
        except RuntimeError:
            raise RuntimeError(f"legacy user record {index} is invalid") from None

    if len({user.email for user in users}) != len(users):
        raise RuntimeError("legacy user emails are not unique after normalization")

    resumes: list[LegacyResume] = []
    for index, row in enumerate(resumes_raw, start=1):
        try:
            legacy_user_id = row["user_id"]
            title = row["title"]
            if legacy_user_id not in legacy_ids:
                raise RuntimeError("legacy resume owner is missing")
            if not isinstance(title, str) or not title.strip() or len(title) > 255:
                raise RuntimeError("legacy resume title is invalid")
            data = _legacy_document(row["markdown"])
            style = _legacy_style(
                row["settings_json"],
                split_ratio=row["split_ratio"],
                preview_scale=row["preview_scale"],
            )
            ResumeSnapshot.model_validate({"data": data, "style": style})
            resumes.append(
                LegacyResume(
                    legacy_user_id=legacy_user_id,
                    title=title.strip(),
                    data=data,
                    style=style,
                    created_at=_parse_datetime(
                        row["created_at"], field="legacy resume created_at"
                    ),
                    updated_at=_parse_datetime(
                        row["updated_at"], field="legacy resume updated_at"
                    ),
                )
            )
        except (RuntimeError, ValueError):
            raise RuntimeError(f"legacy resume record {index} is invalid") from None

    return ImportPlan(
        users=tuple(users),
        resumes=tuple(resumes),
        skipped_sessions=skipped_sessions,
    )


def _nickname(email: str) -> str:
    value = email.partition("@")[0].strip()
    return (value or "用户")[:50]


def _require_empty_target(session: Session) -> None:
    counts = {
        "users": session.scalar(select(func.count()).select_from(User)) or 0,
        "resumes": session.scalar(select(func.count()).select_from(Resume)) or 0,
        "resume_versions": session.scalar(
            select(func.count()).select_from(ResumeVersion)
        )
        or 0,
    }
    if any(counts.values()):
        raise RuntimeError("legacy import requires empty target business tables")


def import_plan(engine: Engine, plan: ImportPlan, *, execute: bool) -> None:
    if engine.url.drivername.startswith("mysql+") and engine.url.database != "linkcv":
        raise RuntimeError("legacy import target must be the linkcv database")
    with Session(engine) as session:
        with session.begin():
            _require_empty_target(session)
            if not execute:
                return
            user_ids: dict[str, int] = {}
            for legacy_user in plan.users:
                user = User(
                    email=legacy_user.email,
                    password_hash=legacy_user.password_hash,
                    nickname=_nickname(legacy_user.email),
                    status=1,
                    is_admin=0,
                    created_at=legacy_user.created_at,
                    updated_at=legacy_user.updated_at,
                )
                session.add(user)
                session.flush()
                user_ids[legacy_user.legacy_id] = user.id

            for legacy_resume in plan.resumes:
                resume = Resume(
                    user_id=user_ids[legacy_resume.legacy_user_id],
                    template_id=None,
                    parse_task_id=None,
                    title=legacy_resume.title,
                    data_json=legacy_resume.data,
                    style_json=legacy_resume.style,
                    lock_version=1,
                    source_type="blank",
                    created_at=legacy_resume.created_at,
                    updated_at=legacy_resume.updated_at,
                )
                session.add(resume)
                session.flush()
                session.add(
                    ResumeVersion(
                        resume_id=resume.id,
                        version_no=1,
                        data_json=legacy_resume.data,
                        style_json=legacy_resume.style,
                        reason="initial",
                        name="初始版本",
                        created_at=legacy_resume.created_at,
                    )
                )
            session.flush()
            imported_users = session.scalar(select(func.count()).select_from(User)) or 0
            imported_resumes = (
                session.scalar(select(func.count()).select_from(Resume)) or 0
            )
            imported_versions = (
                session.scalar(select(func.count()).select_from(ResumeVersion)) or 0
            )
            if (
                imported_users != len(plan.users)
                or imported_resumes != len(plan.resumes)
                or imported_versions != len(plan.resumes)
            ):
                raise RuntimeError("legacy import verification count mismatch")
            orphan_resumes = session.scalar(
                select(func.count())
                .select_from(Resume)
                .outerjoin(User, User.id == Resume.user_id)
                .where(User.id.is_(None))
            )
            orphan_versions = session.scalar(
                select(func.count())
                .select_from(ResumeVersion)
                .outerjoin(Resume, Resume.id == ResumeVersion.resume_id)
                .where(Resume.id.is_(None))
            )
            if orphan_resumes or orphan_versions:
                raise RuntimeError("legacy import verification found orphan records")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate or import legacy Production SQLite data."
    )
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument(
        "--execute", action="store_true", help="write the validated import plan"
    )
    args = parser.parse_args()

    plan = build_import_plan(args.source)
    settings = load_settings()
    engine = build_engine(settings.sqlalchemy_url)
    try:
        import_plan(engine, plan, execute=args.execute)
    finally:
        engine.dispose()
    mode = "execute" if args.execute else "dry-run"
    print(
        "legacy sqlite import: "
        f"mode={mode} users={len(plan.users)} resumes={len(plan.resumes)} "
        f"sessions_skipped={plan.skipped_sessions}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
