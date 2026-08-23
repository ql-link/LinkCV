from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request


@dataclass(frozen=True)
class AuditAction:
    action: str
    target_type: str
    target_param: str | None = None
    target_actor: bool = False


AUDIT_ACTIONS: dict[tuple[str, str], AuditAction] = {
    ("POST", "/api/auth/register"): AuditAction("auth.register", "user"),
    ("POST", "/api/auth/login"): AuditAction("auth.login", "user"),
    ("POST", "/api/auth/admin-login"): AuditAction("auth.admin_login", "user"),
    ("POST", "/api/auth/refresh"): AuditAction("auth.session_refresh", "session"),
    ("POST", "/api/auth/logout"): AuditAction("auth.logout", "session"),
    ("PATCH", "/api/account/profile"): AuditAction(
        "account.profile_update", "user", target_actor=True
    ),
    ("PUT", "/api/account/avatar"): AuditAction(
        "account.avatar_upload", "user", target_actor=True
    ),
    ("DELETE", "/api/account/avatar"): AuditAction(
        "account.avatar_delete", "user", target_actor=True
    ),
    ("POST", "/api/account/change-password"): AuditAction(
        "account.password_change", "user", target_actor=True
    ),
    ("POST", "/api/assets"): AuditAction(
        "account.asset_upload", "user", target_actor=True
    ),
    ("POST", "/api/resumes"): AuditAction("resume.create", "resume"),
    ("POST", "/api/resumes/import"): AuditAction("resume.import", "resume_import"),
    ("PUT", "/api/resumes/{resume_id}"): AuditAction(
        "resume.update", "resume", "resume_id"
    ),
    ("DELETE", "/api/resumes/{resume_id}"): AuditAction(
        "resume.delete", "resume", "resume_id"
    ),
    ("POST", "/api/resumes/{resume_id}/versions"): AuditAction(
        "resume.version_create", "resume_version", "resume_id"
    ),
    ("PATCH", "/api/resumes/{resume_id}/versions/{version_no}"): AuditAction(
        "resume.version_rename", "resume_version", "resume_id"
    ),
    ("DELETE", "/api/resumes/{resume_id}/versions/{version_no}"): AuditAction(
        "resume.version_delete", "resume_version", "resume_id"
    ),
    ("POST", "/api/resumes/{resume_id}/versions/{version_no}/restore"): AuditAction(
        "resume.version_restore", "resume_version", "resume_id"
    ),
    ("POST", "/api/resumes/{resume_id}/assets"): AuditAction(
        "resume.asset_upload", "resume", "resume_id"
    ),
    ("DELETE", "/api/resumes/{resume_id}/assets/{asset_name}"): AuditAction(
        "resume.asset_delete", "resume", "resume_id"
    ),
    ("POST", "/api/job-descriptions"): AuditAction("job.create", "job"),
    ("POST", "/api/job-descriptions/import"): AuditAction(
        "job.import_from_extension", "job"
    ),
    ("PUT", "/api/job-descriptions/{job_id}"): AuditAction(
        "job.update", "job", "job_id"
    ),
    ("POST", "/api/job-descriptions/{job_id}/archive"): AuditAction(
        "job.archive", "job", "job_id"
    ),
    ("POST", "/api/job-descriptions/{job_id}/restore"): AuditAction(
        "job.restore", "job", "job_id"
    ),
    ("DELETE", "/api/job-descriptions/{job_id}"): AuditAction(
        "job.delete", "job", "job_id"
    ),
    ("POST", "/api/job-applications"): AuditAction(
        "interview.application_create", "job_application"
    ),
    ("PUT", "/api/job-applications/{application_id}"): AuditAction(
        "interview.application_update", "job_application", "application_id"
    ),
    ("POST", "/api/job-applications/{application_id}/advance"): AuditAction(
        "interview.application_advance", "job_application", "application_id"
    ),
    ("POST", "/api/job-applications/{application_id}/offer"): AuditAction(
        "interview.offer_update", "job_application", "application_id"
    ),
    ("POST", "/api/job-applications/{application_id}/close"): AuditAction(
        "interview.application_close", "job_application", "application_id"
    ),
    ("POST", "/api/job-applications/{application_id}/archive"): AuditAction(
        "interview.application_archive", "job_application", "application_id"
    ),
    ("POST", "/api/job-applications/{application_id}/restore"): AuditAction(
        "interview.application_restore", "job_application", "application_id"
    ),
    ("DELETE", "/api/job-applications/{application_id}"): AuditAction(
        "interview.application_delete", "job_application", "application_id"
    ),
    (
        "POST",
        "/api/job-applications/{application_id}/interview-sessions",
    ): AuditAction("interview.session_create", "interview_session"),
    ("PUT", "/api/interview-sessions/{session_id}"): AuditAction(
        "interview.session_update", "interview_session", "session_id"
    ),
    ("POST", "/api/interview-sessions/{session_id}/reschedule"): AuditAction(
        "interview.session_reschedule", "interview_session", "session_id"
    ),
    ("POST", "/api/interview-sessions/{session_id}/complete"): AuditAction(
        "interview.session_complete", "interview_session", "session_id"
    ),
    ("POST", "/api/interview-sessions/{session_id}/cancel"): AuditAction(
        "interview.session_cancel", "interview_session", "session_id"
    ),
    ("DELETE", "/api/interview-sessions/{session_id}"): AuditAction(
        "interview.session_delete", "interview_session", "session_id"
    ),
    ("POST", "/api/interview-sessions/{session_id}/assets"): AuditAction(
        "interview.asset_upload", "interview_asset"
    ),
    ("DELETE", "/api/interview-assets/{asset_id}"): AuditAction(
        "interview.asset_delete", "interview_asset", "asset_id"
    ),
    ("PATCH", "/api/auth/admin/users/{user_id}/status"): AuditAction(
        "admin.user_status_change", "user", "user_id"
    ),
    ("POST", "/api/admin/llm/models"): AuditAction(
        "admin.llm_model_create", "llm_model"
    ),
    ("PATCH", "/api/admin/llm/models/{config_id}"): AuditAction(
        "admin.llm_model_update", "llm_model", "config_id"
    ),
    ("POST", "/api/admin/llm/models/{config_id}/test"): AuditAction(
        "admin.llm_model_test", "llm_model", "config_id"
    ),
    ("POST", "/api/admin/llm/models/{config_id}/activate"): AuditAction(
        "admin.llm_model_activate", "llm_model", "config_id"
    ),
}

AUDIT_ACTION_NAMES = frozenset(action.action for action in AUDIT_ACTIONS.values())
AUDIT_ACTION_NAMES_WITH_CLIENT = frozenset((*AUDIT_ACTION_NAMES, "resume.pdf_export"))


def canonical_route_path(request: Request) -> str:
    route = request.scope.get("route")
    route_path = getattr(route, "path", None)
    if not isinstance(route_path, str):
        return "unmatched"
    if request.url.path.startswith("/api/") and not route_path.startswith("/api/"):
        return f"/api{route_path}"
    return route_path


def audit_action_for(request: Request) -> AuditAction | None:
    return AUDIT_ACTIONS.get((request.method.upper(), canonical_route_path(request)))


def bind_audit_actor(request: Request, user_id: int, *, is_admin: bool = False) -> None:
    request.state.actor_user_id = str(user_id)
    request.state.actor_type = "admin" if is_admin else "user"


def bind_audit_target(request: Request, target_id: object) -> None:
    request.state.audit_target_id = str(target_id)


def audit_target_id(request: Request, action: AuditAction) -> str | None:
    explicit = getattr(request.state, "audit_target_id", None)
    if explicit is not None:
        return str(explicit)
    if action.target_actor:
        actor = getattr(request.state, "actor_user_id", None)
        return str(actor) if actor is not None else None
    if action.target_param:
        value = request.path_params.get(action.target_param)
        if action.target_type == "resume_version":
            version_no = request.path_params.get("version_no")
            if value is not None and version_no is not None:
                return f"{value}:{version_no}"
        return str(value) if value is not None else None
    return None
