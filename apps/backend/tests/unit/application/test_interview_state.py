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


def test_screening_targets_distinguish_result_waiting_from_assessment_scheduling() -> None:
    waiting = state(
        stage_type="screening",
        round_no=None,
        stage_label="筛选中",
        stage_state="awaiting_result",
    )

    quick_added = advance_application(
        waiting,
        target_stage_type="screening",
        target_round_no=None,
        target_stage_label="初筛",
    )
    assert quick_added.stage_type == "screening"
    assert quick_added.round_no is None
    assert quick_added.stage_label == "初筛"
    assert quick_added.stage_state == "awaiting_result"

    assessment = advance_application(
        waiting,
        target_stage_type="screening",
        target_round_no=None,
        target_stage_label="在线测评",
    )
    assert assessment.stage_type == "screening"
    assert assessment.stage_state == "awaiting_schedule"


def test_current_stage_allows_only_one_schedule_lifecycle() -> None:
    waiting = state(stage_state="awaiting_schedule")
    scheduled = schedule_current_stage(waiting)

    assert cancel_current_session(scheduled).stage_state == "awaiting_schedule"
    with pytest.raises(InvalidTransition):
        schedule_current_stage(scheduled)
    with pytest.raises(InvalidTransition):
        complete_session(waiting)


def test_received_offer_can_be_recorded_and_reaches_a_final_result() -> None:
    negotiating = state(
        stage_type="offer",
        round_no=None,
        stage_label="Offer",
        stage_state="negotiating",
    )

    received = record_offer(negotiating)
    refreshed = record_offer(received)
    accepted = close_application(refreshed, status="closed", offer_status="accepted")

    assert received.offer_status == "received"
    assert refreshed.offer_status == "received"
    assert accepted.offer_status == "accepted"
    assert accepted.status == "closed"
