"""Voice transcript correction, manual edits and single-question re-evaluation.

All three run only on completed voice interviews and are triggered by the user.
Correction is limited to recognition errors; any result that changes more than
``MAX_CHANGE_RATIO`` of the transcript is rejected instead of trusted.
"""

from __future__ import annotations

import difflib
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.application.mock_interviews import prompts, rubric
from linkresume.application.mock_interviews.outputs import QuestionEvaluation, TranscriptCorrection
from linkresume.application.mock_interviews.service import (
    LLM_SOURCE,
    MockInterviewError,
    _plan_items,
    _root_id,
    _state_invalid,
    _transcript,
    list_questions,
    require_owned,
    score_root,
)
from linkresume.core.database import utc_now
from linkresume.modules.llm.resolver import MOCK_INTERVIEW, TRANSCRIPT_CORRECTION
from linkresume.modules.llm.service import LLMError, LLMService
from linkresume.modules.mock_interviews.models import MockInterview, MockInterviewQuestion

MAX_CHANGE_RATIO = 0.15
MAX_RE_EVALUATIONS = 3
CONTEXT_CHARS = 3_000


def change_ratio(original: str, corrected: str) -> float:
    """Share of the original transcript that was replaced, inserted or deleted."""
    if not original:
        return 1.0 if corrected else 0.0
    changed = 0
    matcher = difflib.SequenceMatcher(a=original, b=corrected, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag != "equal":
            changed += max(i2 - i1, j2 - j1)
    return changed / len(original)


def _completed_voice(db: Session, user_id: int, public_id: str, *, lock: bool = True) -> MockInterview:
    interview = require_owned(db, user_id, public_id, lock=lock)
    if interview.answer_mode != "voice" or interview.status != "completed":
        raise _state_invalid()
    return interview


def _voice_answers(questions: list[MockInterviewQuestion]) -> list[MockInterviewQuestion]:
    return [
        item for item in questions
        if item.answer_status == "answered" and item.answer_source == "voice" and item.answer_text
    ]


# ---------------------------------------------------------------------------
# Whole-interview AI correction (once per interview)
# ---------------------------------------------------------------------------


def claim_correction(db: Session, user_id: int, public_id: str) -> MockInterview:
    """Mark the interview corrected before calling the model so it runs once."""
    interview = _completed_voice(db, user_id, public_id)
    if interview.transcript_corrected_at is not None:
        raise MockInterviewError(409, "MOCK_INTERVIEW_TRANSCRIPT_ALREADY_CORRECTED")
    interview.transcript_corrected_at = utc_now()
    interview.lock_version += 1
    db.commit()
    return interview


def release_correction(db: Session, interview_id: int) -> None:
    """Undo the claim when correction could not run at all (e.g. model unconfigured)."""
    interview = db.get(MockInterview, interview_id)
    if interview is not None:
        interview = require_owned(db, interview.user_id, interview.public_id, lock=True)
        interview.transcript_corrected_at = None
        interview.lock_version += 1
        db.commit()


def correction_inputs(db: Session, interview_id: int):
    interview = db.get(MockInterview, interview_id)
    questions = list_questions(db, interview_id)
    items = [
        {"question_id": item.id, "question": item.content, "transcript": item.answer_text or ""}
        for item in _voice_answers(questions)
        if item.transcript_state in (None, "original")
    ]
    context = (interview.resume_markdown_snapshot or "")[:CONTEXT_CHARS]
    job = (interview.job_snapshot_json or {}).get("description")
    if job:
        context += "\n" + str(job)[:CONTEXT_CHARS]
    return interview.user_id, list(interview.hotwords_json or []), context, items


async def correct_answers(
    llm: LLMService,
    user_id: int,
    glossary: list[str],
    context: str,
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Correct each answer independently; one failure never blocks the rest."""
    results = []
    for item in items:
        original = str(item["transcript"])
        try:
            value = (await llm.structured_chat(
                user_id,
                prompts.transcript_correction_messages(
                    question=str(item["question"]), transcript=original, glossary=glossary, context=context,
                ),
                source=LLM_SOURCE,
                response_model=TranscriptCorrection,
                use_case=TRANSCRIPT_CORRECTION,
            )).value
        except LLMError as error:
            if error.code == "LLM_MODEL_NOT_CONFIGURED":
                raise
            results.append({"question_id": item["question_id"], "state": "correction_rejected",
                            "reason": "model_failed", "changes": []})
            continue
        corrected = value.corrected.strip()
        if corrected == original:
            results.append({"question_id": item["question_id"], "state": "original", "changes": []})
        elif change_ratio(original, corrected) > MAX_CHANGE_RATIO:
            results.append({"question_id": item["question_id"], "state": "correction_rejected",
                            "reason": "change_ratio_exceeded", "changes": []})
        else:
            results.append({
                "question_id": item["question_id"],
                "state": "corrected",
                "corrected": corrected,
                "changes": [change.model_dump() for change in value.changes],
            })
    return results


def _locked_current_interview(db: Session, interview_id: int) -> MockInterview:
    identity = db.execute(select(MockInterview.user_id, MockInterview.public_id).where(MockInterview.id == interview_id)).first()
    if identity is None:
        raise MockInterviewError(404, "MOCK_INTERVIEW_NOT_FOUND")
    return require_owned(db, identity.user_id, identity.public_id, lock=True)


def store_corrections(db: Session, interview_id: int, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    interview = _locked_current_interview(db, interview_id)
    questions = {item.id: item for item in list_questions(db, interview_id)}
    applied_at = utc_now().isoformat()
    public = []
    for result in results:
        question = questions.get(int(result["question_id"]))
        # A manual edit that landed meanwhile wins over the model.
        if question is None or question.transcript_state not in (None, "original"):
            continue
        if result["state"] == "corrected":
            question.corrected_transcript = result["corrected"]
            question.answer_text = result["corrected"]
            question.transcript_state = "corrected"
            question.correction_json = {"applied_at": applied_at, "changes": result["changes"]}
        elif result["state"] == "correction_rejected":
            question.transcript_state = "correction_rejected"
            question.correction_json = {"applied_at": applied_at, "changes": [], "reason": result["reason"]}
        public.append({
            "question_id": str(question.id),
            "state": question.transcript_state,
            "changes": result["changes"],
        })
    interview.lock_version += 1
    db.commit()
    return public


# ---------------------------------------------------------------------------
# Manual edit
# ---------------------------------------------------------------------------


def _voice_question(db: Session, interview: MockInterview, question_id: int) -> MockInterviewQuestion:
    question = db.scalar(
        select(MockInterviewQuestion).where(
            MockInterviewQuestion.id == question_id,
            MockInterviewQuestion.interview_id == interview.id,
        ).with_for_update()
    )
    if question is None or question.answer_source != "voice" or question.answer_status != "answered":
        raise MockInterviewError(404, "MOCK_INTERVIEW_QUESTION_NOT_FOUND")
    return question


def edit_transcript(db: Session, user_id: int, public_id: str, question_id: int, text: str) -> MockInterviewQuestion:
    interview = _completed_voice(db, user_id, public_id)
    question = _voice_question(db, interview, question_id)
    if not question.recording_object_name or interview.recordings_deleted_at is not None:
        raise MockInterviewError(404, "MOCK_INTERVIEW_RECORDING_NOT_FOUND")
    # Measured against the raw recognition so repeated edits cannot drift away.
    if change_ratio(question.raw_transcript or "", text) > MAX_CHANGE_RATIO:
        raise MockInterviewError(422, "MOCK_INTERVIEW_TRANSCRIPT_CORRECTION_REJECTED")
    question.answer_text = text
    question.transcript_state = "edited"
    question.manual_edit_count = min(question.manual_edit_count + 1, 255)
    interview.lock_version += 1
    db.commit()
    return question


# ---------------------------------------------------------------------------
# Single-question re-evaluation
# ---------------------------------------------------------------------------


def reevaluation_context(db: Session, user_id: int, public_id: str, question_id: int):
    interview = _completed_voice(db, user_id, public_id)
    questions = list_questions(db, interview.id)
    root = next((item for item in questions if item.id == question_id and item.parent_id is None), None)
    if root is None:
        raise MockInterviewError(404, "MOCK_INTERVIEW_QUESTION_NOT_FOUND")
    turns = [item for item in questions if _root_id(item) == root.id]
    if not any(item.transcript_state in ("corrected", "edited") for item in turns):
        raise _state_invalid()
    if root.re_evaluate_count >= MAX_RE_EVALUATIONS:
        raise MockInterviewError(409, "MOCK_INTERVIEW_RE_EVALUATE_LIMIT")
    db.commit()
    db.expunge(interview)
    for item in questions:
        db.expunge(item)
    return interview, root, questions


async def judge_question(llm: LLMService, interview: MockInterview, root, questions) -> QuestionEvaluation | None:
    plan = _plan_items(interview)
    turns = [item for item in questions if _root_id(item) == root.id]
    if not any(item.answer_status == "answered" for item in turns):
        return None
    return (await llm.structured_chat(
        interview.user_id,
        prompts.question_evaluation_messages(interview, plan[root.plan_index], _transcript(turns)),
        source=LLM_SOURCE,
        response_model=QuestionEvaluation,
        use_case=MOCK_INTERVIEW,
    )).value


def store_reevaluation(
    db: Session, interview_id: int, root_id: int, questions, value: QuestionEvaluation | None
) -> dict[str, Any]:
    interview = _locked_current_interview(db, interview_id)
    root = db.get(MockInterviewQuestion, root_id)
    if root.re_evaluate_count >= MAX_RE_EVALUATIONS:
        db.rollback()
        raise MockInterviewError(409, "MOCK_INTERVIEW_RE_EVALUATE_LIMIT")
    plan = _plan_items(interview)
    evaluation = score_root(interview, plan[root.plan_index], root, questions, value)
    previous = root.evaluation_json or {}
    history = list(root.evaluation_history_json or [])
    history.append({
        "evaluated_at": utc_now().isoformat(),
        "previous_score": previous.get("score"),
        "score": evaluation["score"],
        "previous": previous,
    })
    root.evaluation_history_json = history
    root.evaluation_json = evaluation
    root.re_evaluate_count += 1

    report = dict(interview.report_json or {})
    results = [dict(item) for item in report.get("questions") or []]
    for index, item in enumerate(results):
        if item.get("sequence_no") == root.sequence_no:
            results[index] = {"topic": item.get("topic"), "sequence_no": root.sequence_no, **evaluation}
    scores = [float(item["score"]) for item in results]
    previous_total = report.get("total_score")
    total = rubric.total_score(scores, float(report.get("dimension_score") or 0))
    report["questions"] = results
    report["question_average"] = round(sum(scores) / len(scores), 2) if scores else 0.0
    report["total_score"] = total
    re_evaluations = list(report.get("re_evaluations") or [])
    re_evaluations.append({
        "sequence_no": root.sequence_no,
        "count": root.re_evaluate_count,
        "previous_score": previous.get("score"),
        "score": evaluation["score"],
        "previous_total": previous_total,
        "total": total,
    })
    report["re_evaluations"] = re_evaluations
    interview.report_json = report
    interview.total_score = Decimal(str(total))
    interview.lock_version += 1
    db.commit()
    return {
        "question_id": str(root.id),
        "evaluation": evaluation,
        "re_evaluate_count": root.re_evaluate_count,
        "remaining": MAX_RE_EVALUATIONS - root.re_evaluate_count,
        "total_score": total,
        "previous_total_score": previous_total,
    }


# ---------------------------------------------------------------------------
# Recordings
# ---------------------------------------------------------------------------


def recording_for(db: Session, user_id: int, public_id: str, question_id: int) -> str:
    interview = require_owned(db, user_id, public_id)
    question = db.scalar(
        select(MockInterviewQuestion).where(
            MockInterviewQuestion.id == question_id,
            MockInterviewQuestion.interview_id == interview.id,
        )
    )
    if question is None or not question.recording_object_name or interview.recordings_deleted_at is not None:
        raise MockInterviewError(404, "MOCK_INTERVIEW_RECORDING_NOT_FOUND")
    return question.recording_object_name


def delete_recordings(db: Session, user_id: int, public_id: str) -> list[str]:
    """Detach recordings; returns object names the caller deletes after commit."""
    interview = require_owned(db, user_id, public_id, lock=True)
    if interview.answer_mode != "voice" or interview.status in ("preparing", "in_progress", "evaluating"):
        raise _state_invalid()
    names = []
    for question in list_questions(db, interview.id):
        if question.recording_object_name:
            names.append(question.recording_object_name)
            question.recording_object_name = None
    interview.recordings_deleted_at = interview.recordings_deleted_at or utc_now()
    interview.lock_version += 1
    db.commit()
    return names
