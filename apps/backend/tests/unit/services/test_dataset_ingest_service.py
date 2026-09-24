import pytest

from linkresume.services.dataset_ingest_service import validate_interview_context


@pytest.mark.parametrize(
    ("interview_session_id", "interview_source_type"),
    [
        (None, None),
        (42, "recorded"),
        (42, "uploaded"),
    ],
)
def test_validate_interview_context_accepts_complete_pairs(
    interview_session_id: int | None,
    interview_source_type: str | None,
) -> None:
    validate_interview_context(
        interview_session_id=interview_session_id,
        interview_source_type=interview_source_type,
    )


@pytest.mark.parametrize(
    ("interview_session_id", "interview_source_type"),
    [
        (42, None),
        (None, "uploaded"),
    ],
)
def test_validate_interview_context_rejects_partial_pairs(
    interview_session_id: int | None,
    interview_source_type: str | None,
) -> None:
    with pytest.raises(ValueError, match="must be set together"):
        validate_interview_context(
            interview_session_id=interview_session_id,
            interview_source_type=interview_source_type,
        )
