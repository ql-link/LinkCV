from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User
from linkcv.modules.plugin_releases.schemas import PluginReleaseCurrentResponse
from linkcv.modules.plugin_releases.service import PluginReleaseService

router = APIRouter(prefix="/plugin-releases", tags=["plugin-releases"])


def get_plugin_release_service(request: Request) -> PluginReleaseService:
    return request.app.state.plugin_release_service


def stream_object(response: Any) -> Iterator[bytes]:
    try:
        for chunk in response.stream(64 * 1024):
            yield chunk
    finally:
        response.close()
        response.release_conn()


@router.get("/current", response_model=PluginReleaseCurrentResponse)
def current_plugin_release(
    _user: User = Depends(get_current_user),
    service: PluginReleaseService = Depends(get_plugin_release_service),
) -> PluginReleaseCurrentResponse:
    pointer = service.current()
    if pointer is None:
        return PluginReleaseCurrentResponse(status="unpublished", release=None)
    return PluginReleaseCurrentResponse(
        status="available",
        release=service.release_from_pointer(pointer),
    )


@router.get("/{version}/download", response_model=None)
def download_plugin_release(
    version: str,
    _user: User = Depends(get_current_user),
    service: PluginReleaseService = Depends(get_plugin_release_service),
) -> StreamingResponse:
    pointer, response = service.open_download(version)
    file_name = f"linkcv-job-capture-v{pointer.version}.zip"
    return StreamingResponse(
        stream_object(response),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{file_name}"',
            "Content-Length": str(pointer.size),
            "ETag": f'"{pointer.sha256}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
