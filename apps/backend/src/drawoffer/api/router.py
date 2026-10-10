from fastapi import APIRouter

from drawoffer.api.routes.health import router as health_router
from drawoffer.modules.admin_insights.routes import router as admin_insights_router
from drawoffer.modules.announcements.admin_routes import router as announcement_admin_router
from drawoffer.modules.announcements.routes import router as announcement_router
from drawoffer.modules.datasets.routes import router as dataset_router
from drawoffer.modules.agent.routes import router as agent_router
from drawoffer.modules.agent.admin_routes import router as agent_admin_router
from drawoffer.modules.identity.admin_routes import router as admin_identity_router
from drawoffer.modules.identity.account_routes import router as account_router
from drawoffer.modules.identity.routes import router as identity_router
from drawoffer.modules.identity.desktop_routes import router as desktop_identity_router
from drawoffer.modules.identity.wechat_routes import router as wechat_router
from drawoffer.modules.interviews.routes import router as interview_router
from drawoffer.modules.job_descriptions.routes import router as job_description_router
from drawoffer.modules.job_matches.routes import router as job_match_router
from drawoffer.modules.llm.admin_routes import router as llm_admin_router
from drawoffer.modules.mock_interviews.routes import router as mock_interview_router
from drawoffer.modules.miniprogram.account_routes import router as miniprogram_account_router
from drawoffer.modules.miniprogram.career_routes import router as miniprogram_career_router
from drawoffer.modules.miniprogram.routes import router as miniprogram_router
from drawoffer.modules.miniprogram.routes import v2_router as miniprogram_v2_router
from drawoffer.modules.observability.routes import router as observability_router
from drawoffer.modules.plugin_releases.admin_routes import router as plugin_release_admin_router
from drawoffer.modules.plugin_releases.routes import router as plugin_release_router
from drawoffer.modules.resumes.asset_routes import router as asset_router
from drawoffer.modules.resumes.import_routes import router as import_router
from drawoffer.modules.resumes.overview_routes import (
    import_router as resume_import_router,
    overview_router,
)
from drawoffer.modules.resumes.pdf_routes import router as resume_pdf_router
from drawoffer.modules.resumes.routes import router as resume_router
from drawoffer.modules.resumes.section_review_routes import router as resume_section_review_router
from drawoffer.modules.resumes.share_routes import public_router as public_share_router
from drawoffer.modules.resumes.share_routes import router as resume_share_router
from drawoffer.modules.resumes.resume_asset_routes import router as resume_asset_router
from drawoffer.modules.resumes.template_routes import router as template_router
from drawoffer.modules.resumes.template_admin_routes import (
    router as template_admin_router,
)

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(agent_router)
api_router.include_router(agent_admin_router)
api_router.include_router(admin_insights_router)
api_router.include_router(announcement_router)
api_router.include_router(announcement_admin_router)
api_router.include_router(admin_identity_router)
api_router.include_router(dataset_router)
api_router.include_router(identity_router)
api_router.include_router(desktop_identity_router)
api_router.include_router(interview_router)
api_router.include_router(wechat_router)
api_router.include_router(account_router)
api_router.include_router(job_description_router)
api_router.include_router(job_match_router)
api_router.include_router(llm_admin_router)
api_router.include_router(mock_interview_router)
api_router.include_router(miniprogram_router)
api_router.include_router(miniprogram_v2_router)
api_router.include_router(miniprogram_account_router)
api_router.include_router(miniprogram_career_router)
api_router.include_router(observability_router)
api_router.include_router(plugin_release_admin_router)
api_router.include_router(plugin_release_router)
api_router.include_router(template_router)
api_router.include_router(template_admin_router)
api_router.include_router(import_router)
api_router.include_router(overview_router)
api_router.include_router(resume_import_router)
api_router.include_router(resume_router)
api_router.include_router(resume_section_review_router)
api_router.include_router(resume_pdf_router)
api_router.include_router(resume_share_router)
api_router.include_router(public_share_router)
api_router.include_router(resume_asset_router)
api_router.include_router(asset_router)
