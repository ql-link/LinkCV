import base64
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, delete, literal, or_, select
from sqlalchemy.orm import Session, load_only

from linkcv.application.resumes.service import (
    close_stale_resume_imports,
    parse_decimal_id,
)
from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.storage import (
    AssetStorage,
    build_import_cleanup_object_names,
    get_storage,
)
from linkcv.modules.identity.dependencies import get_current_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.import_routes import import_summary
from linkcv.modules.resumes.models import (
    RESUME_IMPORT_SOURCE_TYPE,
    DocumentParseTask,
    Resume,
)
from linkcv.modules.resumes.routes import resume_summary
from linkcv.modules.resumes.schemas import (
    DeleteResumeImportResponse,
    ResumeImportResponse,
    ResumeOverviewResponse,
)

logger = logging.getLogger(__name__)
overview_router = APIRouter(tags=["resume-imports"])
import_router = APIRouter(prefix="/resume-imports", tags=["resume-imports"])


def _encode_cursor(created_at: datetime, import_id: int) -> str:
    normalized = created_at
    if normalized.tzinfo is None:
        normalized = normalized.replace(tzinfo=timezone.utc)
    else:
        normalized = normalized.astimezone(timezone.utc)
    payload = json.dumps(
        {"created_at": normalized.isoformat(), "id": str(import_id)},
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_cursor(value: str) -> tuple[datetime, int]:
    try:
        padding = "=" * (-len(value) % 4)
        raw = base64.b64decode(value + padding, altchars=b"-_", validate=True)
        payload = json.loads(raw)
        if set(payload) != {"created_at", "id"}:
            raise ValueError
        created_at = datetime.fromisoformat(payload["created_at"])
        if created_at.tzinfo is None:
            raise ValueError
        created_at = created_at.astimezone(timezone.utc).replace(tzinfo=None)
        import_id = parse_decimal_id(payload["id"])
        if import_id is None:
            raise ValueError
        return created_at, import_id
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        raise ApiError(422, "INVALID_CURSOR") from error


@overview_router.get("/resume-overview", response_model=ResumeOverviewResponse)
def get_resume_overview(
    failed_limit: int = Query(default=20, ge=1, le=50),
    failed_cursor: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> ResumeOverviewResponse:
    close_stale_resume_imports(
        db,
        user_id=user.id,
        upload_stale_seconds=settings.resume_import_upload_stale_seconds,
        parse_stale_seconds=settings.resume_import_parse_stale_seconds,
    )
    resumes = db.scalars(
        select(Resume)
        .options(
            load_only(
                Resume.id,
                Resume.title,
                Resume.source_type,
                Resume.lock_version,
                Resume.created_at,
                Resume.updated_at,
                Resume.data_json,
                Resume.style_json,
            )
        )
        .where(Resume.user_id == user.id)
        .order_by(Resume.updated_at.desc(), Resume.id.desc())
    ).all()
    active = db.scalars(
        select(DocumentParseTask)
        .where(
            DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
            DocumentParseTask.user_id == user.id,
            or_(
                DocumentParseTask.upload_status == "uploading",
                DocumentParseTask.parse_status == "processing",
            ),
        )
        .order_by(
            DocumentParseTask.created_at.desc(),
            DocumentParseTask.id.desc(),
        )
    ).all()
    failed_query = select(DocumentParseTask).where(
        DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
        DocumentParseTask.user_id == user.id,
        or_(
            DocumentParseTask.upload_status == "failed",
            DocumentParseTask.parse_status == "failed",
        ),
    )
    if failed_cursor:
        created_at, import_id = _decode_cursor(failed_cursor)
        cursor_timestamp = created_at.isoformat(
            sep=" ",
            timespec="microseconds" if created_at.microsecond else "seconds",
        )
        cursor_boundary = literal(cursor_timestamp)
        failed_query = failed_query.where(
            or_(
                DocumentParseTask.created_at < cursor_boundary,
                and_(
                    DocumentParseTask.created_at == cursor_boundary,
                    DocumentParseTask.id < import_id,
                ),
            )
        )
    failed = db.scalars(
        failed_query.order_by(
            DocumentParseTask.created_at.desc(),
            DocumentParseTask.id.desc(),
        ).limit(failed_limit + 1)
    ).all()
    next_cursor = None
    if len(failed) > failed_limit:
        failed = failed[:failed_limit]
        last = failed[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    return ResumeOverviewResponse(
        resumes=[resume_summary(item) for item in resumes],
        active_imports=[import_summary(db, item) for item in active],
        failed_imports=[import_summary(db, item) for item in failed],
        next_failed_cursor=next_cursor,
    )


@import_router.get("/{import_id}", response_model=ResumeImportResponse)
def get_resume_import(
    import_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> ResumeImportResponse:
    close_stale_resume_imports(
        db,
        user_id=user.id,
        upload_stale_seconds=settings.resume_import_upload_stale_seconds,
        parse_stale_seconds=settings.resume_import_parse_stale_seconds,
    )
    parsed_id = parse_decimal_id(import_id)
    record = (
        db.scalar(
            select(DocumentParseTask).where(
                DocumentParseTask.id == parsed_id,
                DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
                DocumentParseTask.user_id == user.id,
            )
        )
        if parsed_id is not None
        else None
    )
    if record is None:
        raise ApiError(404, "RESUME_IMPORT_NOT_FOUND")
    return ResumeImportResponse.model_validate({"import": import_summary(db, record)})


@import_router.delete("/{import_id}", response_model=DeleteResumeImportResponse)
def delete_resume_import(
    import_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> DeleteResumeImportResponse:
    parsed_id = parse_decimal_id(import_id)
    record = (
        db.scalar(
            select(DocumentParseTask)
            .where(
                DocumentParseTask.id == parsed_id,
                DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
                DocumentParseTask.user_id == user.id,
            )
            .with_for_update()
        )
        if parsed_id is not None
        else None
    )
    if record is None:
        raise ApiError(404, "RESUME_IMPORT_NOT_FOUND")
    if record.upload_status == "uploading" or record.parse_status == "processing":
        raise ApiError(409, "RESUME_IMPORT_IN_PROGRESS")
    if record.parse_status == "succeeded":
        raise ApiError(409, "RESUME_IMPORT_HAS_RESULT")
    try:
        for object_name in build_import_cleanup_object_names(
            user.id,
            record.object_name,
            record.converted_object_name,
        ):
            storage.delete(object_name)
    except Exception as error:
        db.rollback()
        logger.warning(
            "resume import storage cleanup failed",
            extra={
                "import_id": record.id,
                "error_type": type(error).__name__,
            },
        )
        raise ApiError(502, "ASSET_DELETE_FAILED") from error
    result = db.execute(
        delete(DocumentParseTask).where(
            DocumentParseTask.id == record.id,
            DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
        )
    )
    db.commit()
    return DeleteResumeImportResponse(deleted=bool(result.rowcount))
