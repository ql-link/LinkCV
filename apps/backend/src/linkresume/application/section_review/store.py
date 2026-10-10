"""Saved section focus results: the latest analysis per paragraph and its items.

Writes happen in short transactions after the model has answered. Each one
locks the resume row first, so writes for the same resume (two tabs analysing
the same paragraph, a late rewrite racing an apply) run one after another.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from linkresume.application.resumes.service import parse_decimal_id
from linkresume.modules.resumes.models import Resume
from linkresume.modules.resumes.section_review_models import (
    ResumeSectionReview,
    ResumeSectionReviewItem,
)
from linkresume.modules.resumes.section_review_schemas import (
    MAX_REVIEW_ITEMS,
    SectionReviewAnalyzeRequest,
    SectionReviewAnalyzeResult,
    SectionReviewDraft,
    SectionReviewEdit,
    SectionReviewItem,
    SectionReviewItemUpdate,
    SectionReviewNote,
    SectionReviewRecord,
    SectionReviewRewriteRequest,
    SectionReviewVariant,
)

# Notes of applied items, keyed by item id, so a re-analysis does not lose them.
RETAINED_NOTES = "retained_notes"
PROPOSAL_LABEL = "提案"


class SectionReviewNotFound(LookupError):
    """The saved analysis or item does not exist, or is not the caller's."""


class SectionReviewItemApplied(RuntimeError):
    """The item was applied; a rewrite must not turn it back to pending."""


class SectionReviewItemLimit(RuntimeError):
    """The paragraph already holds the maximum number of items."""


class SectionReviewInvalidTransition(ValueError):
    """The requested status change or field combination is not allowed."""


# --- reading ----------------------------------------------------------------


def _note_for(review: ResumeSectionReview, item: ResumeSectionReviewItem) -> SectionReviewNote | None:
    result = review.result_json
    retained = (result.get(RETAINED_NOTES) or {}).get(str(item.id))
    if retained is not None:
        return SectionReviewNote.model_validate(retained)
    if item.note_id is None:
        return None
    note = next((note for note in result.get("notes", []) if note.get("id") == item.note_id), None)
    return SectionReviewNote.model_validate(note) if note else None


def item_view(review: ResumeSectionReview, item: ResumeSectionReviewItem) -> SectionReviewItem:
    return SectionReviewItem(
        id=str(item.id),
        review_id=str(item.review_id),
        note_id=item.note_id,
        note=_note_for(review, item),
        kind=item.kind,  # type: ignore[arg-type]
        line_id=item.line_id,
        instruction=item.instruction,
        status=item.status,  # type: ignore[arg-type]
        question_index=item.question_index,
        answers=list(item.answers_json),
        draft=SectionReviewDraft.model_validate(item.draft_json) if item.draft_json else None,
        selected_index=item.selected_index,
        edit=SectionReviewEdit.model_validate(item.edit_json) if item.edit_json else None,
        update_time=item.update_time,
    )


def record_view(review: ResumeSectionReview, items: list[ResumeSectionReviewItem]) -> SectionReviewRecord:
    result = {key: value for key, value in review.result_json.items() if key != RETAINED_NOTES}
    return SectionReviewRecord(
        id=str(review.id),
        unit_id=review.unit_id,
        analysis_no=review.analysis_no,
        reference=review.reference_json,
        job_id=str(review.job_id) if review.job_id is not None else None,
        intent=review.intent,
        context_ids=list(review.context_ids_json),
        base_lines=dict(review.base_lines_json),
        result=SectionReviewAnalyzeResult.model_validate(result),
        items=[item_view(review, item) for item in items],
        update_time=review.update_time,
    )


def _items(db: Session, review: ResumeSectionReview) -> list[ResumeSectionReviewItem]:
    return list(
        db.scalars(
            select(ResumeSectionReviewItem)
            .where(
                ResumeSectionReviewItem.resume_id == review.resume_id,
                ResumeSectionReviewItem.review_id == review.id,
            )
            .order_by(ResumeSectionReviewItem.id)
        )
    )


def list_reviews(db: Session, user_id: int, resume_id: int) -> list[SectionReviewRecord]:
    reviews = list(
        db.scalars(
            select(ResumeSectionReview)
            .where(
                ResumeSectionReview.resume_id == resume_id,
                ResumeSectionReview.user_id == user_id,
            )
            .order_by(ResumeSectionReview.unit_id)
        )
    )
    if not reviews:
        return []
    by_review: dict[int, list[ResumeSectionReviewItem]] = {review.id: [] for review in reviews}
    for item in db.scalars(
        select(ResumeSectionReviewItem)
        .where(
            ResumeSectionReviewItem.resume_id == resume_id,
            ResumeSectionReviewItem.user_id == user_id,
        )
        .order_by(ResumeSectionReviewItem.review_id, ResumeSectionReviewItem.id)
    ):
        if item.review_id in by_review:
            by_review[item.review_id].append(item)
    return [record_view(review, by_review[review.id]) for review in reviews]


# --- ownership and locking ---------------------------------------------------


def lock_resume(db: Session, user_id: int, resume_id: int) -> None:
    """Serialize saved-result writes per resume; missing or foreign resumes are not found."""
    owned = db.scalar(
        select(Resume.id)
        .where(Resume.id == resume_id, Resume.user_id == user_id)
        .with_for_update()
    )
    if owned is None:
        raise SectionReviewNotFound


def find_review(db: Session, user_id: int, resume_id: int, review_id: str) -> ResumeSectionReview:
    parsed = parse_decimal_id(review_id)
    review = (
        db.scalar(
            select(ResumeSectionReview).where(
                ResumeSectionReview.id == parsed,
                ResumeSectionReview.resume_id == resume_id,
                ResumeSectionReview.user_id == user_id,
            )
        )
        if parsed is not None
        else None
    )
    if review is None:
        raise SectionReviewNotFound
    return review


def find_item(db: Session, review: ResumeSectionReview, item_id: str) -> ResumeSectionReviewItem:
    parsed = parse_decimal_id(item_id)
    item = (
        db.scalar(
            select(ResumeSectionReviewItem).where(
                ResumeSectionReviewItem.id == parsed,
                ResumeSectionReviewItem.review_id == review.id,
                ResumeSectionReviewItem.resume_id == review.resume_id,
                ResumeSectionReviewItem.user_id == review.user_id,
            )
        )
        if parsed is not None
        else None
    )
    if item is None:
        raise SectionReviewNotFound
    return item


def _item_count(db: Session, review: ResumeSectionReview, *, excluding_open_drafts: bool) -> int:
    """Items not yet applied; applied ones are kept across re-analysis and do not count."""
    query = select(func.count()).select_from(ResumeSectionReviewItem).where(
        ResumeSectionReviewItem.resume_id == review.resume_id,
        ResumeSectionReviewItem.review_id == review.id,
        ResumeSectionReviewItem.status != "done",
    )
    if excluding_open_drafts:
        # A new draft replaces the unapplied one, so that one does not count.
        query = query.where(ResumeSectionReviewItem.kind != "draft")
    return int(db.scalar(query) or 0)


# --- analysis ---------------------------------------------------------------


def _item_for_note(
    review: ResumeSectionReview,
    note: SectionReviewNote,
    base_lines: dict[str, str],
    fallback_line: str | None,
) -> ResumeSectionReviewItem:
    draft: dict[str, Any] | None = None
    if note.kind == "wording" and note.line_id:
        draft = SectionReviewDraft(
            variants=note.variants, base_text=base_lines.get(note.line_id, ""), line_id=note.line_id
        ).model_dump()
    elif note.kind == "structure" and note.proposal:
        proposal = note.proposal
        draft = SectionReviewDraft(
            variants=[
                SectionReviewVariant(id=f"{note.id}-p", label=PROPOSAL_LABEL, text=proposal.text)
            ],
            base_text=base_lines.get(proposal.line_id, ""),
            line_id=proposal.line_id,
        ).model_dump()
    line_id = note.line_id or (note.proposal.line_id if note.proposal else None) or fallback_line
    return ResumeSectionReviewItem(
        user_id=review.user_id,
        resume_id=review.resume_id,
        review_id=review.id,
        note_id=note.id,
        kind=note.kind,
        line_id=line_id,
        instruction="",
        status="todo",
        question_index=0,
        answers_json=[],
        draft_json=draft,
        selected_index=0,
        edit_json=None,
    )


def save_analysis(
    db: Session,
    user_id: int,
    resume_id: int,
    payload: SectionReviewAnalyzeRequest,
    job_id: int | None,
    result: SectionReviewAnalyzeResult,
) -> SectionReviewRecord:
    """Replace the paragraph's saved analysis; applied items stay, the rest are replaced."""
    lock_resume(db, user_id, resume_id)
    unit_id = payload.section.entry_id
    review = db.scalar(
        select(ResumeSectionReview).where(
            ResumeSectionReview.resume_id == resume_id,
            ResumeSectionReview.unit_id == unit_id,
        )
    )
    base_lines = {line.id: line.text for line in payload.section.lines}
    stored_result: dict[str, Any] = result.model_dump()
    if review is None:
        review = ResumeSectionReview(user_id=user_id, resume_id=resume_id, unit_id=unit_id, analysis_no=1)
        db.add(review)
    else:
        kept = [item for item in _items(db, review) if item.status == "done"]
        stored_result[RETAINED_NOTES] = {
            str(item.id): note.model_dump()
            for item in kept
            if (note := _note_for(review, item)) is not None
        }
        db.execute(
            delete(ResumeSectionReviewItem).where(
                ResumeSectionReviewItem.resume_id == resume_id,
                ResumeSectionReviewItem.review_id == review.id,
                ResumeSectionReviewItem.status != "done",
            )
        )
        review.analysis_no += 1
    review.reference_json = payload.reference.model_dump()
    review.job_id = job_id
    review.intent = (payload.intent or "").strip()
    review.context_ids_json = [item.id for item in payload.context]
    review.base_lines_json = base_lines
    review.result_json = stored_result
    db.flush()
    fallback_line = payload.section.lines[0].id if payload.section.lines else None
    for note in result.notes:
        db.add(_item_for_note(review, note, base_lines, fallback_line))
    db.commit()
    db.refresh(review)
    return record_view(review, _items(db, review))


# --- rewrite ----------------------------------------------------------------


def _check_rewritable(item: ResumeSectionReviewItem) -> None:
    if item.status == "done":
        raise SectionReviewItemApplied
    if item.status == "skipped":
        # Skipped is final; the state machine has no way back to pending.
        raise SectionReviewInvalidTransition


def _draft_answers(review: ResumeSectionReview, payload: SectionReviewRewriteRequest) -> list[str]:
    """Answers by question position; the request leaves unanswered questions out."""
    prompts = [question.get("prompt", "") for question in review.result_json.get("draft_questions", [])]
    answers = [""] * len(prompts)
    for answer in payload.answers:
        if answer.question in prompts:
            answers[prompts.index(answer.question)] = answer.answer.strip()
    return answers


def check_rewrite(db: Session, user_id: int, resume_id: int, payload: SectionReviewRewriteRequest) -> None:
    """Refuse before the model call when the result could not be saved anyway."""
    review = find_review(db, user_id, resume_id, payload.review_id)
    if review.unit_id != payload.section.entry_id:
        raise SectionReviewNotFound
    if payload.item_id is not None:
        _check_rewritable(find_item(db, review, payload.item_id))
    elif _item_count(db, review, excluding_open_drafts=payload.item_kind == "draft") >= MAX_REVIEW_ITEMS:
        raise SectionReviewItemLimit


def save_rewrite(
    db: Session,
    user_id: int,
    resume_id: int,
    payload: SectionReviewRewriteRequest,
    variants: list[SectionReviewVariant],
    missing: list[str],
) -> SectionReviewItem:
    """Store the new candidates on the item, unless it was applied or replaced meanwhile."""
    lock_resume(db, user_id, resume_id)
    review = find_review(db, user_id, resume_id, payload.review_id)
    if review.unit_id != payload.section.entry_id:
        raise SectionReviewNotFound
    target = payload.section.line(payload.line_id) if payload.line_id else None
    draft = SectionReviewDraft(
        variants=variants,
        missing=missing,
        base_text=target.text if target else "",
        line_id=payload.line_id or "",
    ).model_dump()
    if payload.item_id is not None:
        item = find_item(db, review, payload.item_id)
        _check_rewritable(item)
    else:
        if _item_count(db, review, excluding_open_drafts=payload.item_kind == "draft") >= MAX_REVIEW_ITEMS:
            raise SectionReviewItemLimit
        if payload.item_kind == "draft":
            db.execute(
                delete(ResumeSectionReviewItem).where(
                    ResumeSectionReviewItem.resume_id == resume_id,
                    ResumeSectionReviewItem.review_id == review.id,
                    ResumeSectionReviewItem.kind == "draft",
                    ResumeSectionReviewItem.status != "done",
                )
            )
        item = ResumeSectionReviewItem(
            user_id=user_id,
            resume_id=resume_id,
            review_id=review.id,
            note_id=None,
            kind=payload.item_kind,
            line_id=payload.line_id,
            instruction=(payload.instruction or "").strip() if payload.item_kind == "ask" else "",
            question_index=0,
            answers_json=_draft_answers(review, payload) if payload.item_kind == "draft" else [],
            edit_json=None,
        )
        db.add(item)
    item.draft_json = draft
    item.status = "pending"
    item.selected_index = 0
    db.commit()
    db.refresh(item)
    return item_view(review, item)


# --- user actions -----------------------------------------------------------

# Status changes a user may make. A rewrite (server side) is what moves an
# item to pending; undo returns an applied item to pending or todo.
_TRANSITIONS: dict[str, set[str]] = {
    "todo": {"asking", "done", "skipped"},
    "asking": {"done", "skipped"},
    "pending": {"asking", "done", "skipped"},
    "done": {"pending", "todo"},
    "skipped": set(),
}


def _question_count(review: ResumeSectionReview, item: ResumeSectionReviewItem) -> int:
    if item.kind == "draft":
        return len(review.result_json.get("draft_questions", []))
    note = _note_for(review, item)
    return len(note.questions) if note else 0


def update_item(
    db: Session,
    user_id: int,
    resume_id: int,
    review_id: str,
    item_id: str,
    update: SectionReviewItemUpdate,
) -> SectionReviewItem:
    lock_resume(db, user_id, resume_id)
    review = find_review(db, user_id, resume_id, review_id)
    item = find_item(db, review, item_id)
    fields = update.model_fields_set
    current = item.status
    target = update.status if "status" in fields and update.status is not None else current

    if target != current and target not in _TRANSITIONS[current]:
        raise SectionReviewInvalidTransition
    if current == "skipped" and fields - {"status"}:
        raise SectionReviewInvalidTransition
    # Applying needs the before/after text; undo clears it; nothing else touches it.
    if target == "done":
        if current != "done" and ("edit" not in fields or update.edit is None):
            raise SectionReviewInvalidTransition
        if current == "done" and "edit" in fields and (
            update.edit is None or update.edit.model_dump() != item.edit_json
        ):
            raise SectionReviewInvalidTransition
        if fields & {"answers", "question_index", "selected_index"}:
            raise SectionReviewInvalidTransition
    elif "edit" in fields and update.edit is not None:
        raise SectionReviewInvalidTransition
    if current == "done" and target != "done":
        if target == "pending" and item.draft_json is None:
            raise SectionReviewInvalidTransition
    if "selected_index" in fields:
        variants = (item.draft_json or {}).get("variants", [])
        if update.selected_index is None or update.selected_index >= len(variants):
            raise SectionReviewInvalidTransition
    if fields & {"answers", "question_index"}:
        if target not in {"todo", "asking", "pending"} or item.kind not in {"missing", "draft"}:
            raise SectionReviewInvalidTransition
        count = _question_count(review, item)
        if "question_index" in fields and (update.question_index or 0) >= max(count, 1):
            raise SectionReviewInvalidTransition
        if "answers" in fields and len(update.answers or []) > count:
            raise SectionReviewInvalidTransition

    if "answers" in fields and update.answers is not None:
        item.answers_json = [answer.strip() for answer in update.answers]
    if "question_index" in fields and update.question_index is not None:
        item.question_index = update.question_index
    if "selected_index" in fields and update.selected_index is not None:
        item.selected_index = update.selected_index
    if target == "done":
        if current != "done" and update.edit is not None:
            item.edit_json = update.edit.model_dump()
    else:
        item.edit_json = None
    item.status = target
    db.commit()
    db.refresh(item)
    return item_view(review, item)


def delete_resume_reviews(db: Session, resume_id: int) -> None:
    """Remove a resume's saved focus results; runs in the caller's transaction."""
    db.execute(delete(ResumeSectionReviewItem).where(ResumeSectionReviewItem.resume_id == resume_id))
    db.execute(delete(ResumeSectionReview).where(ResumeSectionReview.resume_id == resume_id))
