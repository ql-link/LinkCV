import pytest

from linkcv.application.interviews.state import (
    ApplicationStateValue,
    InvalidTransition,
    advance_application,
    cancel_current_session,
    close_application,
    complete_session,
    record_offer,
    schedule_current_stage,
)


def state(**overrides: object) -> ApplicationStateValue:
    values = {
        "stage_type": "interview",
        "round_no": 1,
        "stage_label": "一面",
        "stage_state": "scheduled",
        "status": "active",
        "offer_status": "none",
    }
    values.update(overrides)
    return ApplicationStateValue(**values)  # type: ignore[arg-type]


def test_completing_a_session_waits_for_result_without_advancing_round() -> None:
    completed = complete_session(state())

    assert completed.stage_type == "interview"
    assert completed.round_no == 1
    assert completed.stage_label == "一面"
    assert completed.stage_state == "awaiting_result"


def test_advancing_requires_an_explicit_forward_stage() -> None:
    waiting = state(stage_state="awaiting_result")

    advanced = advance_application(
        waiting,
        target_stage_type="interview",
        target_round_no=2,
        target_stage_label="二面",
    )

    assert advanced.round_no == 2
    assert advanced.stage_state == "awaiting_schedule"
    with pytest.raises(InvalidTransition):
        advance_application(
            waiting,
            target_stage_type="interview",
            target_round_no=1,
            target_stage_label="一面",
        )


def test_current_stage_allows_only_one_schedule_lifecycle() -> None:
    waiting = state(stage_state="awaiting_schedule")
    scheduled = schedule_current_stage(waiting)

    assert cancel_current_session(scheduled).stage_state == "awaiting_schedule"
    with pytest.raises(InvalidTransition):
        schedule_current_stage(scheduled)
    with pytest.raises(InvalidTransition):
        complete_session(waiting)


def test_written_offer_is_distinct_from_offer_call_and_final_result() -> None:
    negotiating = state(
        stage_type="offer",
        round_no=None,
        stage_label="Offer",
        stage_state="negotiating",
    )

    called = record_offer(negotiating, "oc_received")
    written = record_offer(called, "written_offer_received")
    accepted = close_application(written, status="closed", offer_status="accepted")

    assert called.offer_status == "oc_received"
    assert written.offer_status == "written_offer_received"
    assert accepted.offer_status == "accepted"
    assert accepted.status == "closed"
