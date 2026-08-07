import asyncio

from fastapi import APIRouter, Depends, File, UploadFile

from linkcv.core.errors import ApiError
from linkcv.modules.identity.dependencies import get_current_admin
from linkcv.modules.identity.models import User
from linkcv.modules.plugin_releases.routes import get_plugin_release_service
from linkcv.modules.plugin_releases.schemas import PluginReleasePublishResponse
from linkcv.modules.plugin_releases.service import PluginReleaseService
from linkcv.modules.plugin_releases.validator import (
    MAX_UPLOAD_BYTES,
    PluginPackageValidationError,
)

router = APIRouter(prefix="/admin/plugin-releases", tags=["plugin-release-admin"])


@router.post("", response_model=PluginReleasePublishResponse, status_code=201)
async def publish_plugin_release(
    file: UploadFile = File(...),
    _admin: User = Depends(get_current_admin),
    service: PluginReleaseService = Depends(get_plugin_release_service),
) -> PluginReleasePublishResponse:
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise ApiError(422, "PLUGIN_RELEASE_INVALID_FILE")
    try:
        data = await file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        await file.close()
    if len(data) > MAX_UPLOAD_BYTES:
        raise ApiError(413, "PLUGIN_RELEASE_TOO_LARGE")
    try:
        pointer = await asyncio.to_thread(service.publish, data)
    except PluginPackageValidationError as error:
        status = 413 if str(error) == "PLUGIN_RELEASE_TOO_LARGE" else 422
        raise ApiError(status, str(error)) from error
    return PluginReleasePublishResponse(release=service.release_from_pointer(pointer))
