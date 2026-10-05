"""The product events backfill is idempotent and only reads existing records."""

import importlib.util
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import linkresume.models  # noqa: F401
from linkresume.core.database import Base
from linkresume.modules.identity.models import User
from linkresume.modules.product_events.models import ProductEvent
from linkresume.modules.product_events.service import build_event

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "backfill_product_events", ROOT / "scripts/release/backfill_product_events.py"
)
assert SPEC is not None and SPEC.loader is not None
backfill = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = backfill
SPEC.loader.exec_module(backfill)

NOW = datetime(2026, 9, 20, 8, 0, tzinfo=UTC)


def seed(db: Session) -> tuple[int, int]:
    email_user = User(email="backfill@example.invalid", nickname="张三", create_time=NOW)
    wechat_user = User(wechat_openid="openid-fixture", nickname="微信用户", create_time=NOW + timedelta(hours=1))
    db.add_all([email_user, wechat_user])
    db.flush()
    # A live event already exists for the email user's registration.
    db.add(build_event(user_id=email_user.id, name="user_registered", dedupe_key=f"reg:{email_user.id}",
                       properties={"method": "email"}, occurred_at=NOW))
    db.commit()
    return email_user.id, wechat_user.id


def test_backfill_adds_missing_events_once(monkeypatch) -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        email_id, wechat_id = seed(db)
        extra = [
            backfill.Candidate(email_id, "resume_created", "resume:7", {"source": "template", "resume_id": 7, "backfilled": True}, NOW),
            backfill.Candidate(wechat_id, "ai_customization_applied", "ai:3",
                               {"mode": "rewrite", "entry": "unknown", "resume_id": 7, "proposal_id": 3, "backfilled": True}, NOW),
            # Refers to a user that no longer exists.
            backfill.Candidate(999, "mock_interview_completed", "interview:1", {"answer_mode": "text", "interview_id": 1, "backfilled": True}, NOW),
        ]
        original = backfill.candidates
        monkeypatch.setattr(backfill, "candidates", lambda session: [*original(session), *extra])

        dry = backfill.backfill(db, execute=False)
        assert len(db.scalars(select(ProductEvent)).all()) == 1  # dry run writes nothing
        assert dry["added"] == {"user_registered": 1, "resume_created": 1, "ai_customization_applied": 1}

        first = backfill.backfill(db, execute=True)
        assert first["added"] == dry["added"]
        assert first["skipped"] == {"user_registered": 1}
        assert first["invalid"] == {"mock_interview_completed": 1}

        second = backfill.backfill(db, execute=True)
        assert second["added"] == {}

        rows = {e.dedupe_key: e for e in db.scalars(select(ProductEvent))}
    assert rows[f"reg:{email_id}"].properties_json == {"method": "email"}  # live event kept
    assert rows[f"reg:{wechat_id}"].properties_json == {"backfilled": True}
    assert rows["ai:3"].properties_json["entry"] == "unknown"
    assert all(e.properties_json.get("backfilled") for key, e in rows.items() if key != f"reg:{email_id}")


def test_candidates_read_real_tables() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        seed(db)
        names = [item.name for item in backfill.candidates(db)]
    assert names == ["user_registered", "user_registered"]
