"""Translate names declared by historical migrations into the names they carry today.

0112 renamed yes/no columns to is_xxx, 0114 added surrogate ids and missing time
columns, and 0115 renamed tables (singular), created_at/updated_at and the index
and constraint names that embed a table name. Tests that compare an older
revision's SQL with the current ORM translate the SQL side through these maps.
"""

from __future__ import annotations

TABLE_RENAMES = {
    "account_deletion_jobs": "account_deletion_job",
    "account_preferences": "account_preference",
    "agent_messages": "agent_message",
    "agent_operations": "agent_operation",
    "agent_runs": "agent_run",
    "agent_sessions": "agent_session",
    "agent_stage_events": "agent_stage_event",
    "agent_tool_calls": "agent_tool_call",
    "announcement_read_cursors": "announcement_read_cursor",
    "announcements": "announcement",
    "document_parse_tasks": "document_parse_task",
    "global_companies": "global_company",
    "interview_recording_transcriptions": "interview_recording_transcription",
    "interview_review_question_notes": "interview_review_question_note",
    "interview_sessions": "interview_session",
    "job_application_offer_materials": "job_application_offer_material",
    "job_application_stages": "job_application_stage",
    "job_applications": "job_application",
    "job_descriptions": "job_description",
    "job_resume_matches": "job_resume_match",
    "llm_call_logs": "llm_call_log",
    "llm_model_routes": "llm_model_route",
    "llm_models": "llm_model",
    "llm_provider_connections": "llm_provider_connection",
    "llm_use_case_routes": "llm_use_case_route",
    "mock_interview_questions": "mock_interview_question",
    "mock_interviews": "mock_interview",
    "product_events": "product_event",
    "resume_change_proposals": "resume_change_proposal",
    "resume_templates": "resume_template",
    "resumes": "resume",
    "user_dataset_folders": "user_dataset_folder",
    "user_profiles": "user_profile",
    "users": "user",
}
TIME_COLUMN_RENAMES = {"created_at": "create_time", "updated_at": "update_time"}
BOOLEAN_COLUMN_RENAMES = {
    ("account_preferences", "interview_reminder_enabled"): "is_interview_reminder_enabled",
    ("agent_sessions", "pinned"): "is_pinned",
    ("interview_recording_transcriptions", "pending_replace"): "is_pending_replace",
    ("llm_model_routes", "enabled"): "is_enabled",
    ("llm_model_routes", "target_available"): "is_target_available",
    ("llm_models", "user_selectable"): "is_user_selectable",
    ("llm_provider_connections", "enabled"): "is_enabled",
    ("llm_use_case_routes", "enabled"): "is_enabled",
    ("mock_interviews", "follow_up_enabled"): "is_follow_up_enabled",
    ("mock_interviews", "low_confidence"): "is_low_confidence",
    ("mock_interviews", "materials_in_questions"): "is_materials_in_questions",
    ("resumes", "share_allow_download"): "is_share_allow_download",
}
# Columns and keys that 0114 added to existing tables (current names).
COLUMNS_ADDED_BY_0114 = {
    "account_preferences": {"id"},
    "announcement_read_cursors": {"id", "create_time"},
    "job_application_offer_materials": {"id", "create_time", "update_time"},
    "llm_use_case_routes": {"id", "create_time"},
    "agent_stage_events": {"create_time", "update_time"},
    "agent_operations": {"update_time"},
    "agent_messages": {"update_time"},
    "llm_call_logs": {"update_time"},
    "user_dataset": {"update_time"},
    "product_events": {"update_time"},
}
OBJECTS_ADDED_BY_0114 = {
    "account_preferences": {"uk_account_preference_user_id"},
    "announcement_read_cursors": {"uk_announcement_read_cursor_user_id"},
    "job_application_offer_materials": {"uk_job_application_offer_material_application_dataset"},
    "llm_use_case_routes": {"uk_llm_use_case_route_use_case_route"},
}


def current_table(table: str) -> str:
    return TABLE_RENAMES.get(table, table)


def current_column(table: str, column: str) -> str:
    column = BOOLEAN_COLUMN_RENAMES.get((table, column), column)
    return TIME_COLUMN_RENAMES.get(column, column)


def current_object_name(name: str, table: str) -> str:
    """Index or constraint name after 0115 replaced the owning table's name."""
    new_table = current_table(table)
    for prefix in ("pk_", "uk_", "idx_", "ck_", "fk_"):
        head = prefix + table
        if name == head or name.startswith(head + "_"):
            return prefix + new_table + name[len(head):]
    return name


def current_columns(table: str, declared: set[str]) -> set[str]:
    """Columns a historical CREATE TABLE declared, as they exist after 0115."""
    return {current_column(table, column) for column in declared} | COLUMNS_ADDED_BY_0114.get(table, set())


def current_object_names(table: str, declared: set[str]) -> set[str]:
    return {current_object_name(name, table) for name in declared} | OBJECTS_ADDED_BY_0114.get(table, set())
