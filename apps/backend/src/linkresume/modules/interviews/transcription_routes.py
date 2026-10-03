"""Cookie-owned task management and a separate purpose-signed media download."""
import re

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.application.interviews import transcription_service as service
from linkresume.core.config import Settings
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.core.storage import AssetStorage, get_storage
from linkresume.modules.datasets.models import DatasetTranscriptionTask as Task, TRANSCRIPTION_ACTIVE
from linkresume.modules.identity.dependencies import get_current_dataset_user, get_settings, lock_active_user
from linkresume.modules.identity.models import User
from linkresume.modules.interviews.routes import _database_id, _raise_service_error
from linkresume.modules.interviews.schemas import (
    TranscriptionCreateRequest, TranscriptionCancelRequest, TranscriptionTaskResponse, TranscriptionCapability,
)
from linkresume.modules.llm.service import LLMService
from linkresume.modules.llm.dependencies import get_llm_service
from linkresume.modules.speech.media_token import decode_audio_token, probe_wav

router = APIRouter(tags=["interviews"])


def owned_context(db, uid, sid, did=None, **kwargs):
    try:
        return service.context(db, uid, _database_id(sid), _database_id(did) if did else None, **kwargs)
    except Exception as error:
        _raise_service_error(error)


@router.get("/interview-sessions/{session_id}/transcription-capability", response_model=TranscriptionCapability)
def capability(session_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_dataset_user),
               settings: Settings = Depends(get_settings), llm: LLMService = Depends(get_llm_service)):
    owned_context(db, user.id, session_id)
    if not settings.asr_media_base_url:
        return {"available": False, "error_code": "INTERVIEW_TRANSCRIPTION_MEDIA_UNAVAILABLE"}
    try:
        service.select_plan(db, llm)
    except ApiError as error:
        return {"available": False, "error_code": error.code}
    return {"available": True, "error_code": None}


@router.get("/interview-sessions/{session_id}/assets/{dataset_id}/transcription", response_model=TranscriptionTaskResponse)
def latest(session_id: str, dataset_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_dataset_user)):
    owned_context(db, user.id, session_id, dataset_id)
    return {"task": service.task_record(service.latest(db, user.id, _database_id(dataset_id)))}


@router.post("/interview-sessions/{session_id}/assets/{dataset_id}/transcription", response_model=TranscriptionTaskResponse)
def create(session_id: str, dataset_id: str, payload: TranscriptionCreateRequest, response: Response,
           db: Session = Depends(get_db), user: User = Depends(get_current_dataset_user),
           settings: Settings = Depends(get_settings), llm: LLMService = Depends(get_llm_service)):
    try:
        task, created = service.create_task(db, user.id, _database_id(session_id), _database_id(dataset_id),
                                           payload.request_id, settings=settings, llm=llm)
    except Exception as error:
        _raise_service_error(error)
    response.status_code = 202 if created else 200
    return {"task": service.task_record(task)}


@router.post("/interview-sessions/{session_id}/assets/{dataset_id}/transcription/cancel", response_model=TranscriptionTaskResponse)
def cancel(session_id: str, dataset_id: str, payload: TranscriptionCancelRequest,
           db: Session = Depends(get_db), user: User = Depends(get_current_dataset_user)):
    lock_active_user(db, user.id)
    owned_context(db, user.id, session_id, dataset_id)
    task = db.scalar(select(Task).where(Task.id == _database_id(payload.task_id), Task.user_id == user.id,
                                      Task.dataset_id == _database_id(dataset_id)).with_for_update())
    if task is None:
        raise ApiError(404, "INTERVIEW_TRANSCRIPTION_NOT_FOUND")
    if task.status in TRANSCRIPTION_ACTIVE:
        service.finish(db, task, "cancelled", "INTERVIEW_TRANSCRIPTION_CANCELLED")
        db.commit()
    return {"task": service.task_record(task)}


def byte_range(header: str | None, size: int) -> tuple[int, int, bool]:
    if not header:
        return 0, size, False
    match = re.fullmatch(r"bytes=(\d{0,20})-(\d{0,20})", header)
    if not match or not any(match.groups()) or size <= 0:
        raise ApiError(416, "RANGE_NOT_SATISFIABLE", headers={"Content-Range": f"bytes */{size}"})
    left, right = match.groups()
    if not left:
        suffix = int(right)
        start, end = max(0, size - suffix), size - 1
        if suffix == 0:
            start = size
    else:
        start, end = int(left), min(int(right), size - 1) if right else size - 1
    if start > end or start >= size:
        raise ApiError(416, "RANGE_NOT_SATISFIABLE", headers={"Content-Range": f"bytes */{size}"})
    return start, end - start + 1, True


@router.api_route("/interview-asr/audio", methods=["GET", "HEAD"])
def audio(request: Request, token: str = Query(min_length=1, max_length=2048), db: Session = Depends(get_db),
          settings: Settings = Depends(get_settings), storage: AssetStorage = Depends(get_storage)):
    claims = decode_audio_token(settings, token)
    data = None
    if claims["purpose"] == "probe":
        data, content_type = probe_wav(), "audio/wav"
        size = len(data)
    else:
        if any(type(claims.get(key)) is not int for key in ("task_id", "user_id", "dataset_id")):
            raise ApiError(404, "NOT_FOUND")
        task = db.get(Task, claims["task_id"])
        if (task is None or task.status not in TRANSCRIPTION_ACTIVE or task.user_id != claims["user_id"]
                or task.dataset_id != claims["dataset_id"]):
            raise ApiError(404, "NOT_FOUND")
        dataset = service.active_context(db, task)
        if dataset is None or dataset.sha256 != claims.get("sha256"):
            raise ApiError(404, "NOT_FOUND")
        size, content_type = dataset.file_size, dataset.content_type
    offset, length, partial = byte_range(request.headers.get("range"), size)
    headers = {"Content-Length": str(length), "Accept-Ranges": "bytes", "Cache-Control": "no-store", "Content-Encoding": "identity"}
    if partial:
        headers["Content-Range"] = f"bytes {offset}-{offset + length - 1}/{size}"
    status = 206 if partial else 200
    if request.method == "HEAD":
        return Response(status_code=status, headers=headers, media_type=content_type)
    if data is not None:
        return StreamingResponse(iter([data[offset:offset+length]]), status_code=status, headers=headers, media_type=content_type)
    try:
        source = storage.get(dataset.object_name, offset=offset, length=length)
    except Exception as error:
        raise ApiError(404, "NOT_FOUND") from error
    def stream():
        try:
            yield from source.stream(64 * 1024)
        finally:
            source.close()
            source.release_conn()
    return StreamingResponse(stream(), status_code=status, headers=headers, media_type=content_type)
