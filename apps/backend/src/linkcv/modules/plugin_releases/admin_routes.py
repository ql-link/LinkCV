import asyncio

from fastapi import APIRouter, Depends, File, UploadFile

from linkcv.core.errors import ApiError
from linkcv.modules.identity.dependencies import get_current_admin
from linkcv.modules.identity.models import User
from linkcv.modules.plugin_releases.routes import get_plugin_release_service
from linkcv.modules.plugin_releases.schemas import (
    AdminPluginReleaseCurrentResponse,
    PluginReleaseDeleteResponse,
    PluginReleasePublishResponse,
    PluginReleaseReactivateResponse,
    PluginReleaseUnpublishResponse,
)
from linkcv.modules.plugin_releases.service import PluginReleaseService
from linkcv.modules.plugin_releases.validator import (
    MAX_UPLOAD_BYTES,
    PluginPackageValidationError,
)

router = APIRouter(prefix="/admin/plugin-releases", tags=["plugin-release-admin"])


@router.get("/current", response_model=AdminPluginReleaseCurrentResponse)
async def get_admin_plugin_release(
    _admin: User = Depends(get_current_admin),
    service: PluginReleaseService = Depends(get_plugin_release_service),
) -> AdminPluginReleaseCurrentResponse:
    pointer = await asyncio.to_thread(service.admin_current)
    if pointer is None:
        return AdminPluginReleaseCurrentResponse(status="absent", release=None)
    return AdminPluginReleaseCurrentResponse(
        status=pointer.status,
        release=service.release_from_pointer(pointer),
    )


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
        result = await asyncio.to_thread(service.publish, data)
    except PluginPackageValidationError as error:
        status = 413 if str(error) == "PLUGIN_RELEASE_TOO_LARGE" else 422
        raise ApiError(status, str(error)) from error
    return PluginReleasePublishResponse(
        release=service.release_from_pointer(result.pointer),
        cleanup_pending=result.cleanup_pending,
    )


@router.delete("/current", response_model=PluginReleaseUnpublishResponse)
async def unpublish_plugin_release(
    _admin: User = Depends(get_current_admin),
    service: PluginReleaseService = Depends(get_plugin_release_service),
) -> PluginReleaseUnpublishResponse:
    pointer = await asyncio.to_thread(service.unpublish)
    return PluginReleaseUnpublishResponse(
        release=service.release_from_pointer(pointer),
    )


@router.post("/current/publish", response_model=PluginReleaseReactivateResponse)
async def reactivate_plugin_release(
    _admin: User = Depends(get_current_admin),
    service: PluginReleaseService = Depends(get_plugin_release_service),
) -> PluginReleaseReactivateResponse:
    pointer = await asyncio.to_thread(service.reactivate)
    return PluginReleaseReactivateResponse(
        release=service.release_from_pointer(pointer),
    )


@router.delete("/current/package", response_model=PluginReleaseDeleteResponse)
async def delete_plugin_release(
    _admin: User = Depends(get_current_admin),
    service: PluginReleaseService = Depends(get_plugin_release_service),
) -> PluginReleaseDeleteResponse:
    await asyncio.to_thread(service.delete_current)
    return PluginReleaseDeleteResponse()
