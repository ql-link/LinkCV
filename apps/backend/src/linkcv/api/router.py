from fastapi import APIRouter

from linkcv.api.routes.health import router as health_router
from linkcv.modules.identity.routes import router as identity_router
from linkcv.modules.llm.admin_routes import router as llm_admin_router
from linkcv.modules.resumes.asset_routes import router as asset_router
from linkcv.modules.resumes.routes import router as resume_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(identity_router)
api_router.include_router(llm_admin_router)
api_router.include_router(resume_router)
api_router.include_router(asset_router)
