from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from sqlalchemy.orm import Session

from linkcv.application.resumes.service import has_resume_capacity
from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.storage import AssetStorage, get_storage
from linkcv.domain.rag import RagConverter
from linkcv.integrations.llm_client import ResumeStructuringClient
from linkcv.modules.identity.dependencies import get_current_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.routes import resume_record
from linkcv.modules.resumes.schemas import (
    ResumeImportMetadata,
    ResumeImportResponse,
)
from linkcv.services.import_admission import (
    ImportAdmissionController,
    ImportAdmissionRejected,
)
from linkcv.services.resume_import_service import (
    ResumeImportFailure,
    ResumeImportService,
)

router = APIRouter(prefix="/resumes", tags=["resume-imports"])


def get_rag_converter(request: Request) -> RagConverter:
    return request.app.state.rag_converter


def get_structuring_client(request: Request) -> ResumeStructuringClient:
    return request.app.state.structuring_client


def get_import_admission(request: Request) -> ImportAdmissionController:
    return request.app.state.import_admission


@router.post("/import", response_model=ResumeImportResponse, status_code=201)
async def import_resume(
    file: UploadFile = File(...),
    title: str | None = Form(default=None, max_length=255),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
    rag_converter: RagConverter = Depends(get_rag_converter),
    structuring_client: ResumeStructuringClient = Depends(get_structuring_client),
    import_admission: ImportAdmissionController = Depends(get_import_admission),
) -> ResumeImportResponse:
    filename = file.filename or "resume.bin"
    content_type = (file.content_type or "application/octet-stream").lower()
    try:
        if not has_resume_capacity(db, user.id):
            raise ApiError(409, "RESUME_LIMIT_REACHED")
        async with import_admission.acquire(user.id):
            content = await file.read(settings.resume_import_max_bytes + 1)
            service = ResumeImportService(
                rag_converter=rag_converter,
                structuring_client=structuring_client,
                storage=storage,
                max_file_bytes=settings.resume_import_max_bytes,
                max_markdown_bytes=settings.resume_markdown_max_bytes,
                max_structuring_bytes=settings.resume_structuring_max_bytes,
            )
            result = await service.import_resume(
                db=db,
                user_id=user.id,
                filename=filename,
                content_type=content_type,
                content=content,
                title=title,
            )
    except ImportAdmissionRejected as error:
        raise ApiError(429, "IMPORT_RATE_LIMITED") from error
    except ResumeImportFailure as error:
        raise ApiError(error.status_code, error.code) from error
    finally:
        await file.close()

    return ResumeImportResponse(
        resume=resume_record(result.resume),
        **{
            "import": ResumeImportMetadata(
                source_file_name=result.source_file_name,
                source_file_format=result.source_file_format,
                warnings=result.warnings,
            )
        },
    )
