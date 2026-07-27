from fastapi import APIRouter

from linkcv.api.routes.health import router as health_router
from linkcv.modules.identity.routes import router as identity_router
from linkcv.modules.resumes.asset_routes import router as asset_router
from linkcv.modules.resumes.import_routes import router as import_router
from linkcv.modules.resumes.routes import router as resume_router
from linkcv.modules.resumes.resume_asset_routes import router as resume_asset_router
from linkcv.modules.resumes.template_routes import router as template_router
from linkcv.modules.resumes.version_routes import router as version_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(identity_router)
api_router.include_router(template_router)
api_router.include_router(import_router)
api_router.include_router(resume_router)
api_router.include_router(version_router)
api_router.include_router(resume_asset_router)
api_router.include_router(asset_router)
