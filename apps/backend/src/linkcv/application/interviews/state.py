from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal


ApplicationStatus = Literal["active", "rejected", "withdrawn", "closed"]
StageType = Literal["screening", "interview", "hr", "offer"]
StageState = Literal["awaiting_schedule", "scheduled", "awaiting_result", "negotiating"]
OfferStatus = Literal[
    "none", "oc_received", "written_offer_received", "accepted", "declined"
]

POST_APPLICATION_SCREENING_LABEL = "筛选中"


def is_assessment_stage_label(stage_label: str) -> bool:
    """Return whether a screening label represents an assessment.

    Assessments intentionally remain represented by the existing ``screening``
    stage type.  Keep this compatibility rule narrow and label-based so that
    ordinary screening labels (for example, ``初筛`` or ``复筛``) continue to
    enter the result-waiting state.
    """

    normalized = stage_label.strip().casefold()
    return "笔试" in normalized or "测评" in normalized or "assessment" in normalized


class InvalidTransition(ValueError):
    pass


@dataclass(frozen=True)
class ApplicationStateValue:
    stage_type: StageType
    round_no: int | None
    stage_label: str
    stage_state: StageState
    status: ApplicationStatus
    offer_status: OfferStatus


def validate_stage_context(
    stage_type: StageType,
    round_no: int | None,
    stage_label: str,
) -> None:
    if not stage_label.strip():
        raise InvalidTransition("stage label cannot be blank")
    if stage_type == "interview":
        if round_no is None or round_no < 1:
            raise InvalidTransition("interview stage requires a positive round number")
    elif round_no is not None:
        raise InvalidTransition("only interview stages can carry a round number")


def complete_session(state: ApplicationStateValue) -> ApplicationStateValue:
    if state.status != "active":
        raise InvalidTransition("closed applications cannot complete new interviews")
    if state.stage_state != "scheduled":
        raise InvalidTransition("only the scheduled current stage can be completed")
    return replace(state, stage_state="awaiting_result")


def cancel_current_session(state: ApplicationStateValue) -> ApplicationStateValue:
    if state.status != "active":
        raise InvalidTransition("closed applications cannot be rescheduled")
    if state.stage_state != "scheduled":
        raise InvalidTransition("only the scheduled current stage can be cancelled")
    return replace(state, stage_state="awaiting_schedule")


def schedule_current_stage(state: ApplicationStateValue) -> ApplicationStateValue:
    if state.status != "active":
        raise InvalidTransition("closed applications cannot schedule interviews")
    if state.stage_type == "offer":
        raise InvalidTransition("offer stages do not accept interview schedules")
    if state.stage_state != "awaiting_schedule":
        raise InvalidTransition("the current stage is not waiting to be scheduled")
    return replace(state, stage_state="scheduled")


def advance_application(
    state: ApplicationStateValue,
    *,
    target_stage_type: StageType,
    target_round_no: int | None,
    target_stage_label: str,
) -> ApplicationStateValue:
    if state.status != "active":
        raise InvalidTransition("closed applications cannot advance")
    if state.stage_state != "awaiting_result":
        raise InvalidTransition("the current stage is not waiting for a result")
    validate_stage_context(target_stage_type, target_round_no, target_stage_label)
    if target_stage_type == "interview" and state.stage_type == "interview":
        if (
            target_round_no is None
            or state.round_no is None
            or target_round_no <= state.round_no
        ):
            raise InvalidTransition("the next interview round must move forward")
    if target_stage_type == "offer":
        target_state: StageState = "negotiating"
    elif target_stage_type == "screening" and not is_assessment_stage_label(
        target_stage_label
    ):
        target_state = "awaiting_result"
    else:
        target_state = "awaiting_schedule"
    return ApplicationStateValue(
        stage_type=target_stage_type,
        round_no=target_round_no,
        stage_label=target_stage_label.strip(),
        stage_state=target_state,
        status="active",
        offer_status=state.offer_status,
    )


def record_offer(
    state: ApplicationStateValue,
    offer_status: Literal["oc_received", "written_offer_received"],
) -> ApplicationStateValue:
    if state.status != "active" or state.stage_type != "offer":
        raise InvalidTransition("the application is not in offer negotiation")
    if state.offer_status == "written_offer_received" and offer_status == "oc_received":
        raise InvalidTransition("a written offer cannot move back to an offer call")
    if state.offer_status in {"accepted", "declined"}:
        raise InvalidTransition("the offer has already reached a final result")
    return replace(state, stage_state="negotiating", offer_status=offer_status)


def close_application(
    state: ApplicationStateValue,
    *,
    status: ApplicationStatus,
    offer_status: Literal["accepted", "declined"] | None = None,
) -> ApplicationStateValue:
    if status == "active":
        raise InvalidTransition("close cannot keep an application active")
    if state.status != "active":
        if state.status == status and (
            offer_status is None or state.offer_status == offer_status
        ):
            return state
        raise InvalidTransition("the application is already closed")
    if offer_status is not None:
        if state.offer_status not in {"written_offer_received", offer_status}:
            raise InvalidTransition("a final offer result requires a written offer")
        if status != "closed":
            raise InvalidTransition("offer results close the application")
        return replace(state, status="closed", offer_status=offer_status)
    if status == "rejected" and state.stage_state != "awaiting_result":
        raise InvalidTransition("rejection requires a stage waiting for a result")
    return replace(state, status=status)
