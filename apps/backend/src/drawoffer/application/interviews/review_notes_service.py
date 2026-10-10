"""Per-question review notes anchored to the normalized question text.

Notes survive report regeneration: a regenerated report with the same
question text carries the same key, so the note re-attaches on its own.
Notes whose question no longer appears stay listed for the user to re-anchor
or delete.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from drawoffer.application.interviews.review_service import question_key
from drawoffer.core.database import utc_now
from drawoffer.core.errors import ApiError
from drawoffer.modules.identity.dependencies import lock_active_user
from drawoffer.modules.interviews.models import InterviewReviewQuestionNote


def save_note(
    db: Session,
    user_id: int,
    session_id: int,
    *,
    question_text: str,
    verdict: str | None,
    note: str | None,
    lock_version: int | None,
) -> InterviewReviewQuestionNote | None:
    """Create or update; returns ``None`` when an emptied note was removed."""
    from drawoffer.application.interviews.service import InterviewEditConflict, require_owned_session

    lock_active_user(db, user_id)
    require_owned_session(db, user_id, session_id, for_update=True)
    key = question_key(question_text)
    row = db.scalar(
        select(InterviewReviewQuestionNote)
        .where(
            InterviewReviewQuestionNote.session_id == session_id,
            InterviewReviewQuestionNote.question_key == key,
        )
        .with_for_update()
    )
    text = (note or "").strip() or None
    if row is not None and lock_version != row.lock_version:
        raise InterviewEditConflict
    if row is None and lock_version is not None:
        raise InterviewEditConflict
    if text is None and verdict is None:
        if row is not None:
            db.delete(row)
            db.commit()
        return None
    now = utc_now()
    if row is None:
        row = InterviewReviewQuestionNote(
            user_id=user_id,
            session_id=session_id,
            question_key=key,
            question_text=question_text.strip(),
            verdict=verdict,
            note=text,
            lock_version=1,
            create_time=now,
            update_time=now,
        )
        db.add(row)
    else:
        row.verdict = verdict
        row.note = text
        row.question_text = question_text.strip()
        row.lock_version += 1
        row.update_time = now
    db.commit()
    db.refresh(row)
    return row


def delete_note(db: Session, user_id: int, session_id: int, note_id: int) -> None:
    from drawoffer.application.interviews.service import require_owned_session

    lock_active_user(db, user_id)
    require_owned_session(db, user_id, session_id, for_update=True)
    row = db.scalar(
        select(InterviewReviewQuestionNote).where(
            InterviewReviewQuestionNote.id == note_id,
            InterviewReviewQuestionNote.session_id == session_id,
            InterviewReviewQuestionNote.user_id == user_id,
        )
    )
    if row is None:
        raise ApiError(404, "INTERVIEW_REVIEW_NOTE_NOT_FOUND")
    db.delete(row)
    db.commit()
