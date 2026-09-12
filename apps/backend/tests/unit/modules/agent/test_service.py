from types import SimpleNamespace

from linkcv.modules.agent.service import (
    create_proposal,
    create_session,
    reject_proposal,
    upsert_tool_event,
)
from tests.canonical_resume_fixtures import canonical_resume_payload


class RecordingSession:
    def __init__(self, scalar_results: list[object | None]) -> None:
        self.scalar_results = iter(scalar_results)
        self.scalar_statements: list[object] = []

    def scalar(self, statement):
        self.scalar_statements.append(statement)
        return next(self.scalar_results)

    def add(self, _record: object) -> None:
        pass

    def commit(self) -> None:
        pass

    def refresh(self, _record: object) -> None:
        pass


def assert_for_update(statement: object) -> None:
    assert getattr(statement, "_for_update_arg", None) is not None


def test_create_session_locks_resume_lifecycle_row() -> None:
    db = RecordingSession([SimpleNamespace(id=7, title="张三的简历")])

    record = create_session(
        db,  # type: ignore[arg-type]
        user_id=3,
        resume_id="7",
        title=None,
    )

    assert record.resume_id == 7
    assert_for_update(db.scalar_statements[0])


def test_create_proposal_locks_resume_before_idempotency_lookup() -> None:
    db = RecordingSession([SimpleNamespace(id=7, lock_version=4), None])
    data, style = canonical_resume_payload()

    proposal = create_proposal(
        db,  # type: ignore[arg-type]
        run=SimpleNamespace(id=11),
        session=SimpleNamespace(resume_id=7, user_id=3),
        call_key="proposal-call",
        data=data,
        style=style,
        summary="生成一份待确认修改",
        ttl_days=30,
    )

    assert proposal.resume_id == 7
    assert_for_update(db.scalar_statements[0])
    assert getattr(db.scalar_statements[1], "_for_update_arg", None) is None


def test_reject_proposal_locks_proposal_before_terminal_transition() -> None:
    pending = SimpleNamespace(status="pending")
    db = RecordingSession([pending])

    result = reject_proposal(
        db,  # type: ignore[arg-type]
        public_id="proposal-public-id",
        user_id=3,
    )

    assert result.status == "rejected"
    assert_for_update(db.scalar_statements[0])


def test_tool_event_locks_run_before_idempotency_lookup() -> None:
    db = RecordingSession(["running", None])

    record = upsert_tool_event(
        db,  # type: ignore[arg-type]
        run=SimpleNamespace(id=11),
        payload=SimpleNamespace(
            call_key="tool-call",
            tool_name="get_resume_context",
            status="running",
            target_type=None,
            target_id=None,
            error_code=None,
            duration_ms=None,
        ),
    )

    assert record.call_key == "tool-call"
    assert_for_update(db.scalar_statements[0])
    assert getattr(db.scalar_statements[1], "_for_update_arg", None) is None
