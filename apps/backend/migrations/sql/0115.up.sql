-- 0115: Alibaba MySQL naming. created_at/updated_at become create_time/update_time,
-- plural table names become singular, and index and CHECK names follow the new table names.
-- MySQL refuses to rename a column used by a CHECK constraint, so affected checks are
-- dropped first and recreated (re-validated) after the renames. RENAME TABLE runs as one
-- atomic statement. Index renames are metadata-only.

ALTER TABLE `account_deletion_jobs`
	DROP CHECK `ck_account_deletion_jobs_phase`,
	DROP CHECK `ck_account_deletion_jobs_status`;

ALTER TABLE `account_deletion_jobs`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_account_deletion_jobs_public` TO `uk_account_deletion_job_public`,
	RENAME INDEX `uk_account_deletion_jobs_user` TO `uk_account_deletion_job_user`,
	RENAME INDEX `idx_account_deletion_jobs_due` TO `idx_account_deletion_job_due`,
	RENAME INDEX `idx_account_deletion_jobs_completed` TO `idx_account_deletion_job_completed`;

ALTER TABLE `account_preferences`
	DROP CHECK `ck_account_preferences_is_interview_reminder_enabled`,
	DROP CHECK `ck_account_preferences_locale`;

ALTER TABLE `account_preferences`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_account_preferences_user_id` TO `uk_account_preference_user_id`;

ALTER TABLE `agent_messages`
	DROP CHECK `ck_agent_messages_message_type`,
	DROP CHECK `ck_agent_messages_role`;

ALTER TABLE `agent_messages`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_agent_messages_session_sequence` TO `uk_agent_message_session_sequence`,
	RENAME INDEX `idx_agent_messages_session_created` TO `idx_agent_message_session_created`;

ALTER TABLE `agent_operations`
	DROP CHECK `ck_agent_operations_state`;

ALTER TABLE `agent_operations`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_agent_operations_public_id` TO `uk_agent_operation_public_id`,
	RENAME INDEX `idx_agent_operations_state_created` TO `idx_agent_operation_state_created`,
	RENAME INDEX `idx_agent_operations_created` TO `idx_agent_operation_created`,
	RENAME INDEX `idx_agent_operations_session` TO `idx_agent_operation_session`;

ALTER TABLE `agent_runs`
	DROP CHECK `ck_agent_runs_cost_nonnegative`,
	DROP CHECK `ck_agent_runs_input_tokens_nonnegative`,
	DROP CHECK `ck_agent_runs_output_tokens_nonnegative`,
	DROP CHECK `ck_agent_runs_status`;

ALTER TABLE `agent_runs`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_agent_runs_public_id` TO `uk_agent_run_public_id`,
	RENAME INDEX `uk_agent_runs_session_idempotency` TO `uk_agent_run_session_idempotency`,
	RENAME INDEX `idx_agent_runs_session_created` TO `idx_agent_run_session_created`,
	RENAME INDEX `idx_agent_runs_status_updated` TO `idx_agent_run_status_updated`,
	RENAME INDEX `idx_agent_runs_created` TO `idx_agent_run_created`,
	RENAME INDEX `idx_agent_runs_resolved_llm_model_id` TO `idx_agent_run_resolved_llm_model_id`,
	RENAME INDEX `idx_agent_runs_resolved_llm_route_id` TO `idx_agent_run_resolved_llm_route_id`;

ALTER TABLE `agent_sessions`
	DROP CHECK `ck_agent_sessions_is_pinned`,
	DROP CHECK `ck_agent_sessions_status`;

ALTER TABLE `agent_sessions`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_agent_sessions_public_id` TO `uk_agent_session_public_id`,
	RENAME INDEX `idx_agent_sessions_user_is_pinned_updated` TO `idx_agent_session_user_is_pinned_updated`,
	RENAME INDEX `idx_agent_sessions_selected_llm_model_id` TO `idx_agent_session_selected_llm_model_id`;

ALTER TABLE `agent_stage_events`
	DROP CHECK `ck_agent_stage_events_result`;

ALTER TABLE `agent_stage_events`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_agent_stage_events_operation_key` TO `uk_agent_stage_event_operation_key`,
	RENAME INDEX `idx_agent_stage_events_operation_time` TO `idx_agent_stage_event_operation_time`;

ALTER TABLE `agent_tool_calls`
	DROP CHECK `ck_agent_tool_calls_status`;

ALTER TABLE `agent_tool_calls`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_agent_tool_calls_run_key` TO `uk_agent_tool_call_run_key`,
	RENAME INDEX `idx_agent_tool_calls_run_created` TO `idx_agent_tool_call_run_created`,
	RENAME INDEX `idx_agent_tool_calls_tool_created` TO `idx_agent_tool_call_tool_created`;

ALTER TABLE `announcement_read_cursors`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_announcement_read_cursors_user_id` TO `uk_announcement_read_cursor_user_id`;

ALTER TABLE `announcements`
	DROP CHECK `ck_announcements_level`,
	DROP CHECK `ck_announcements_state_fields`,
	DROP CHECK `ck_announcements_status`,
	DROP CHECK `ck_announcements_window`;

ALTER TABLE `announcements`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `idx_announcements_created_by` TO `idx_announcement_created_by`,
	RENAME INDEX `idx_announcements_updated_by` TO `idx_announcement_updated_by`,
	RENAME INDEX `idx_announcements_published_by` TO `idx_announcement_published_by`,
	RENAME INDEX `idx_announcements_unpublished_by` TO `idx_announcement_unpublished_by`,
	RENAME INDEX `idx_announcements_status_published` TO `idx_announcement_status_published`;

ALTER TABLE `document_parse_tasks`
	DROP CHECK `ck_document_parse_tasks_file_format`,
	DROP CHECK `ck_document_parse_tasks_lifecycle`,
	DROP CHECK `ck_document_parse_tasks_parse_status`,
	DROP CHECK `ck_document_parse_tasks_source_type`,
	DROP CHECK `ck_document_parse_tasks_upload_status`;

ALTER TABLE `document_parse_tasks`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `idx_document_parse_tasks_user_created_id` TO `idx_document_parse_task_user_created_id`,
	RENAME INDEX `idx_document_parse_tasks_user_state` TO `idx_document_parse_task_user_state`,
	RENAME INDEX `idx_document_parse_tasks_dispatch` TO `idx_document_parse_task_dispatch`,
	RENAME INDEX `idx_document_parse_tasks_selected_template` TO `idx_document_parse_task_selected_template`;

ALTER TABLE `global_companies`
	DROP CHECK `ck_global_companies_company_name_not_blank`,
	DROP CHECK `ck_global_companies_normalized_name_not_blank`;

ALTER TABLE `global_companies`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_global_companies_normalized_name` TO `uk_global_company_normalized_name`;

ALTER TABLE `interview_recording_transcriptions`
	DROP CHECK `ck_interview_recording_transcriptions_is_pending_replace`,
	DROP CHECK `ck_interview_recording_transcriptions_status`;

ALTER TABLE `interview_recording_transcriptions`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_interview_recording_transcriptions_dataset` TO `uk_interview_recording_transcription_dataset`,
	RENAME INDEX `idx_interview_recording_transcriptions_user_id` TO `idx_interview_recording_transcription_user_id`,
	RENAME INDEX `idx_interview_recording_transcriptions_due` TO `idx_interview_recording_transcription_due`,
	RENAME INDEX `idx_interview_recording_transcriptions_session` TO `idx_interview_recording_transcription_session`;

ALTER TABLE `interview_review_question_notes`
	DROP CHECK `ck_interview_review_question_notes_verdict`;

ALTER TABLE `interview_review_question_notes`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_interview_review_question_notes_session_key` TO `uk_interview_review_question_note_session_key`,
	RENAME INDEX `idx_interview_review_question_notes_user_id` TO `idx_interview_review_question_note_user_id`;

ALTER TABLE `interview_sessions`
	DROP CHECK `ck_interview_sessions_answer_plan`,
	DROP CHECK `ck_interview_sessions_lifecycle`,
	DROP CHECK `ck_interview_sessions_lock_version`,
	DROP CHECK `ck_interview_sessions_mode`,
	DROP CHECK `ck_interview_sessions_reminder_minutes`,
	DROP CHECK `ck_interview_sessions_round_result`,
	DROP CHECK `ck_interview_sessions_schedule_kind`,
	DROP CHECK `ck_interview_sessions_stage_context`,
	DROP CHECK `ck_interview_sessions_stage_type`,
	DROP CHECK `ck_interview_sessions_status`,
	DROP CHECK `ck_interview_sessions_time_range`,
	DROP CHECK `ck_interview_sessions_transcript_source`;

ALTER TABLE `interview_sessions`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_interview_sessions_application_request` TO `uk_interview_session_application_request`,
	RENAME INDEX `idx_interview_sessions_application_time` TO `idx_interview_session_application_time`,
	RENAME INDEX `idx_interview_sessions_application_status_time` TO `idx_interview_session_application_status_time`,
	RENAME INDEX `idx_interview_sessions_application_completed` TO `idx_interview_session_application_completed`,
	RENAME INDEX `idx_interview_sessions_stage_time` TO `idx_interview_session_stage_time`,
	RENAME INDEX `idx_interview_sessions_stage_status` TO `idx_interview_session_stage_status`;

ALTER TABLE `job_application_offer_materials`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_job_application_offer_materials_application_dataset` TO `uk_job_application_offer_material_application_dataset`;

ALTER TABLE `job_application_stages`
	DROP CHECK `ck_job_application_stages_completed_context`,
	DROP CHECK `ck_job_application_stages_current_context`,
	DROP CHECK `ck_job_application_stages_result`,
	DROP CHECK `ck_job_application_stages_round_context`,
	DROP CHECK `ck_job_application_stages_status`,
	DROP CHECK `ck_job_application_stages_type`;

ALTER TABLE `job_application_stages`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_job_application_stages_request` TO `uk_job_application_stage_request`,
	RENAME INDEX `uk_job_application_stages_sequence` TO `uk_job_application_stage_sequence`,
	RENAME INDEX `uk_job_application_stages_current` TO `uk_job_application_stage_current`,
	RENAME INDEX `idx_job_application_stages_application_order` TO `idx_job_application_stage_application_order`,
	RENAME INDEX `idx_job_application_stages_application_status` TO `idx_job_application_stage_application_status`;

ALTER TABLE `job_applications`
	DROP CHECK `ck_job_applications_calendar_color`,
	DROP CHECK `ck_job_applications_is_favorite`,
	DROP CHECK `ck_job_applications_job_snapshot_object`,
	DROP CHECK `ck_job_applications_lifecycle_status`,
	DROP CHECK `ck_job_applications_lock_version`,
	DROP CHECK `ck_job_applications_offer_salary_context`,
	DROP CHECK `ck_job_applications_offer_salary_currency`,
	DROP CHECK `ck_job_applications_offer_salary_period`,
	DROP CHECK `ck_job_applications_offer_status`,
	DROP CHECK `ck_job_applications_round_context`,
	DROP CHECK `ck_job_applications_snapshots_not_blank`,
	DROP CHECK `ck_job_applications_stage_state`,
	DROP CHECK `ck_job_applications_stage_type`,
	DROP CHECK `ck_job_applications_status`,
	DROP CHECK `ck_job_applications_termination_context`;

ALTER TABLE `job_applications`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `idx_job_applications_user_scope_updated` TO `idx_job_application_user_scope_updated`,
	RENAME INDEX `idx_job_applications_user_stage` TO `idx_job_application_user_stage`,
	RENAME INDEX `idx_job_applications_user_offer` TO `idx_job_application_user_offer`,
	RENAME INDEX `idx_job_applications_job_description` TO `idx_job_application_job_description`,
	RENAME INDEX `idx_job_applications_user_lifecycle_updated` TO `idx_job_application_user_lifecycle_updated`,
	RENAME INDEX `idx_job_applications_resume` TO `idx_job_application_resume`;

ALTER TABLE `job_descriptions`
	DROP CHECK `ck_job_descriptions_company_name_not_blank`,
	DROP CHECK `ck_job_descriptions_employment_type`,
	DROP CHECK `ck_job_descriptions_job_title_not_blank`,
	DROP CHECK `ck_job_descriptions_lock_version`,
	DROP CHECK `ck_job_descriptions_salary_context`,
	DROP CHECK `ck_job_descriptions_salary_currency`,
	DROP CHECK `ck_job_descriptions_salary_max`,
	DROP CHECK `ck_job_descriptions_salary_min`,
	DROP CHECK `ck_job_descriptions_salary_months`,
	DROP CHECK `ck_job_descriptions_salary_period`,
	DROP CHECK `ck_job_descriptions_salary_range`,
	DROP CHECK `ck_job_descriptions_skills_array`,
	DROP CHECK `ck_job_descriptions_source_fields`,
	DROP CHECK `ck_job_descriptions_source_type`,
	DROP CHECK `ck_job_descriptions_work_mode`;

ALTER TABLE `job_descriptions`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_job_descriptions_user_source_job` TO `uk_job_description_user_source_job`,
	RENAME INDEX `uk_job_descriptions_user_source_url` TO `uk_job_description_user_source_url`,
	RENAME INDEX `idx_job_descriptions_user_updated_id` TO `idx_job_description_user_updated_id`;

ALTER TABLE `job_resume_matches`
	DROP CHECK `ck_job_resume_matches_ready`,
	DROP CHECK `ck_job_resume_matches_score`,
	DROP CHECK `ck_job_resume_matches_source`,
	DROP CHECK `ck_job_resume_matches_status`;

ALTER TABLE `job_resume_matches`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_job_resume_matches_job_resume` TO `uk_job_resume_match_job_resume`,
	RENAME INDEX `idx_job_resume_matches_resume_id` TO `idx_job_resume_match_resume_id`,
	RENAME INDEX `idx_job_resume_matches_user_resume_score` TO `idx_job_resume_match_user_resume_score`;

ALTER TABLE `llm_call_logs`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_llm_call_logs_call_id` TO `uk_llm_call_log_call_id`;

ALTER TABLE `llm_model_routes`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`;

ALTER TABLE `llm_models`
	DROP CHECK `ck_llm_models_is_user_selectable`;

ALTER TABLE `llm_models`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`;

ALTER TABLE `llm_provider_connections`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`;

ALTER TABLE `llm_use_case_routes`
	DROP CHECK `ck_llm_use_case_routes_is_enabled`;

ALTER TABLE `llm_use_case_routes`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `idx_llm_use_case_routes_route` TO `idx_llm_use_case_route_route`,
	RENAME INDEX `uk_llm_use_case_routes_use_case_route` TO `uk_llm_use_case_route_use_case_route`;

ALTER TABLE `mock_interview_questions`
	DROP CHECK `ck_mock_interview_questions_answer`,
	DROP CHECK `ck_mock_interview_questions_answer_source`,
	DROP CHECK `ck_mock_interview_questions_answer_status`,
	DROP CHECK `ck_mock_interview_questions_depth`,
	DROP CHECK `ck_mock_interview_questions_transcript_state`;

ALTER TABLE `mock_interview_questions`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_mock_interview_questions_sequence` TO `uk_mock_interview_question_sequence`,
	RENAME INDEX `idx_mock_interview_questions_parent` TO `idx_mock_interview_question_parent`;

ALTER TABLE `mock_interviews`
	DROP CHECK `ck_mock_interviews_answer_mode`,
	DROP CHECK `ck_mock_interviews_difficulty`,
	DROP CHECK `ck_mock_interviews_is_follow_up_enabled`,
	DROP CHECK `ck_mock_interviews_is_low_confidence`,
	DROP CHECK `ck_mock_interviews_is_materials_in_questions`,
	DROP CHECK `ck_mock_interviews_language`,
	DROP CHECK `ck_mock_interviews_lock_version`,
	DROP CHECK `ck_mock_interviews_question_count`,
	DROP CHECK `ck_mock_interviews_score`,
	DROP CHECK `ck_mock_interviews_source_type`,
	DROP CHECK `ck_mock_interviews_status`,
	DROP CHECK `ck_mock_interviews_type`;

ALTER TABLE `mock_interviews`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_mock_interviews_public_id` TO `uk_mock_interview_public_id`,
	RENAME INDEX `uk_mock_interviews_active_user` TO `uk_mock_interview_active_user`,
	RENAME INDEX `idx_mock_interviews_user_created` TO `idx_mock_interview_user_created`,
	RENAME INDEX `idx_mock_interviews_application` TO `idx_mock_interview_application`,
	RENAME INDEX `idx_mock_interviews_resume` TO `idx_mock_interview_resume`,
	RENAME INDEX `idx_mock_interviews_job` TO `idx_mock_interview_job`,
	RENAME INDEX `idx_mock_interviews_repeat_of` TO `idx_mock_interview_repeat_of`;

ALTER TABLE `product_events`
	DROP CHECK `ck_product_events_name`;

ALTER TABLE `product_events`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_product_events_dedupe` TO `uk_product_event_dedupe`,
	RENAME INDEX `idx_product_events_name_time` TO `idx_product_event_name_time`,
	RENAME INDEX `idx_product_events_user_name` TO `idx_product_event_user_name`;

ALTER TABLE `resume_change_proposals`
	DROP CHECK `ck_resume_change_proposals_lock_versions`,
	DROP CHECK `ck_resume_change_proposals_mode`,
	DROP CHECK `ck_resume_change_proposals_status`,
	DROP CHECK `ck_resume_change_proposals_translation_result`;

ALTER TABLE `resume_change_proposals`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_resume_change_proposals_public_id` TO `uk_resume_change_proposal_public_id`,
	RENAME INDEX `uk_resume_change_proposals_run_call_key` TO `uk_resume_change_proposal_run_call_key`,
	RENAME INDEX `idx_resume_change_proposals_user_created` TO `idx_resume_change_proposal_user_created`,
	RENAME INDEX `idx_resume_change_proposals_resume_status_created` TO `idx_resume_change_proposal_resume_status_created`,
	RENAME INDEX `idx_resume_change_proposals_pending_expiry` TO `idx_resume_change_proposal_pending_expiry`;

ALTER TABLE `resume_templates`
	DROP CHECK `ck_resume_templates_is_active`,
	DROP CHECK `ck_resume_templates_sort_order`;

ALTER TABLE `resume_templates`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_resume_templates_key` TO `uk_resume_template_key`;

ALTER TABLE `resumes`
	DROP CHECK `ck_resumes_creation_request_pair`,
	DROP CHECK `ck_resumes_is_share_allow_download`,
	DROP CHECK `ck_resumes_lock_version`,
	DROP CHECK `ck_resumes_share_fields`,
	DROP CHECK `ck_resumes_share_visibility`,
	DROP CHECK `ck_resumes_source_type`,
	DROP CHECK `ck_resumes_title_not_blank`;

ALTER TABLE `resumes`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_resumes_share_token` TO `uk_resume_share_token`,
	RENAME INDEX `uk_resumes_parse_task_id` TO `uk_resume_parse_task_id`,
	RENAME INDEX `uk_resumes_user_creation_request` TO `uk_resume_user_creation_request`,
	RENAME INDEX `idx_resumes_user_updated_id` TO `idx_resume_user_updated_id`,
	RENAME INDEX `idx_resumes_template_id` TO `idx_resume_template_id`;

ALTER TABLE `user_dataset`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`;

ALTER TABLE `user_dataset_folders`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_user_dataset_folders_user_name` TO `uk_user_dataset_folder_user_name`,
	RENAME INDEX `idx_user_dataset_folders_user_created` TO `idx_user_dataset_folder_user_created`;

ALTER TABLE `user_dataset_rag_sync`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`;

ALTER TABLE `user_profiles`
	DROP CHECK `ck_user_profiles_campus_experiences_array`,
	DROP CHECK `ck_user_profiles_candidate_cities_array`,
	DROP CHECK `ck_user_profiles_candidate_experience_context`,
	DROP CHECK `ck_user_profiles_candidate_status`,
	DROP CHECK `ck_user_profiles_certifications_array`,
	DROP CHECK `ck_user_profiles_education_level`,
	DROP CHECK `ck_user_profiles_employment_types_array`,
	DROP CHECK `ck_user_profiles_graduation_year`,
	DROP CHECK `ck_user_profiles_honors_array`,
	DROP CHECK `ck_user_profiles_languages_array`,
	DROP CHECK `ck_user_profiles_lock_version`,
	DROP CHECK `ck_user_profiles_salary_context`,
	DROP CHECK `ck_user_profiles_salary_currency`,
	DROP CHECK `ck_user_profiles_salary_period`,
	DROP CHECK `ck_user_profiles_salary_range`,
	DROP CHECK `ck_user_profiles_school_tier_array`,
	DROP CHECK `ck_user_profiles_skills_array`,
	DROP CHECK `ck_user_profiles_years_experience`;

ALTER TABLE `user_profiles`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_user_profiles_user_id` TO `uk_user_profile_user_id`,
	RENAME INDEX `idx_user_profiles_user_updated` TO `idx_user_profile_user_updated`;

ALTER TABLE `users`
	DROP CHECK `ck_users_is_admin`,
	DROP CHECK `ck_users_status`;

ALTER TABLE `users`
	RENAME COLUMN `created_at` TO `create_time`,
	RENAME COLUMN `updated_at` TO `update_time`,
	RENAME INDEX `uk_users_email` TO `uk_user_email`,
	RENAME INDEX `uk_users_wechat_openid` TO `uk_user_wechat_openid`;

RENAME TABLE
	`account_deletion_jobs` TO `account_deletion_job`,
	`account_preferences` TO `account_preference`,
	`agent_messages` TO `agent_message`,
	`agent_operations` TO `agent_operation`,
	`agent_runs` TO `agent_run`,
	`agent_sessions` TO `agent_session`,
	`agent_stage_events` TO `agent_stage_event`,
	`agent_tool_calls` TO `agent_tool_call`,
	`announcement_read_cursors` TO `announcement_read_cursor`,
	`announcements` TO `announcement`,
	`document_parse_tasks` TO `document_parse_task`,
	`global_companies` TO `global_company`,
	`interview_recording_transcriptions` TO `interview_recording_transcription`,
	`interview_review_question_notes` TO `interview_review_question_note`,
	`interview_sessions` TO `interview_session`,
	`job_application_offer_materials` TO `job_application_offer_material`,
	`job_application_stages` TO `job_application_stage`,
	`job_applications` TO `job_application`,
	`job_descriptions` TO `job_description`,
	`job_resume_matches` TO `job_resume_match`,
	`llm_call_logs` TO `llm_call_log`,
	`llm_model_routes` TO `llm_model_route`,
	`llm_models` TO `llm_model`,
	`llm_provider_connections` TO `llm_provider_connection`,
	`llm_use_case_routes` TO `llm_use_case_route`,
	`mock_interview_questions` TO `mock_interview_question`,
	`mock_interviews` TO `mock_interview`,
	`product_events` TO `product_event`,
	`resume_change_proposals` TO `resume_change_proposal`,
	`resume_templates` TO `resume_template`,
	`resumes` TO `resume`,
	`user_dataset_folders` TO `user_dataset_folder`,
	`user_profiles` TO `user_profile`,
	`users` TO `user`;

ALTER TABLE `account_deletion_job`
	ADD CONSTRAINT `ck_account_deletion_job_phase` CHECK ((`phase` in (_utf8mb4'database',_utf8mb4'objects',_utf8mb4'rag',_utf8mb4'complete')));

ALTER TABLE `account_deletion_job`
	ADD CONSTRAINT `ck_account_deletion_job_status` CHECK ((`status` in (_utf8mb4'pending',_utf8mb4'processing',_utf8mb4'retry_wait',_utf8mb4'needs_attention',_utf8mb4'completed')));

ALTER TABLE `account_preference`
	ADD CONSTRAINT `ck_account_preference_is_interview_reminder_enabled` CHECK ((`is_interview_reminder_enabled` in (0,1)));

ALTER TABLE `account_preference`
	ADD CONSTRAINT `ck_account_preference_locale` CHECK ((`locale` in (_utf8mb4'zh-CN',_utf8mb4'en-US')));

ALTER TABLE `agent_message`
	ADD CONSTRAINT `ck_agent_message_message_type` CHECK ((`message_type` in (_utf8mb4'text',_utf8mb4'clarification')));

ALTER TABLE `agent_message`
	ADD CONSTRAINT `ck_agent_message_role` CHECK ((`role` in (_utf8mb4'user',_utf8mb4'assistant')));

ALTER TABLE `agent_operation`
	ADD CONSTRAINT `ck_agent_operation_state` CHECK ((`state` in (_utf8mb4'preflighting',_utf8mb4'failed',_utf8mb4'run_created')));

ALTER TABLE `agent_run`
	ADD CONSTRAINT `ck_agent_run_cost_nonnegative` CHECK (((`estimated_cost` is null) or (`estimated_cost` >= 0)));

ALTER TABLE `agent_run`
	ADD CONSTRAINT `ck_agent_run_input_tokens_nonnegative` CHECK (((`input_tokens` is null) or (`input_tokens` >= 0)));

ALTER TABLE `agent_run`
	ADD CONSTRAINT `ck_agent_run_output_tokens_nonnegative` CHECK (((`output_tokens` is null) or (`output_tokens` >= 0)));

ALTER TABLE `agent_run`
	ADD CONSTRAINT `ck_agent_run_status` CHECK ((`status` in (_utf8mb4'running',_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'cancelled')));

ALTER TABLE `agent_session`
	ADD CONSTRAINT `ck_agent_session_is_pinned` CHECK ((`is_pinned` in (0,1)));

ALTER TABLE `agent_session`
	ADD CONSTRAINT `ck_agent_session_status` CHECK ((`status` in (_utf8mb4'active',_utf8mb4'archived')));

ALTER TABLE `agent_stage_event`
	ADD CONSTRAINT `ck_agent_stage_event_result` CHECK ((`result` in (_utf8mb4'started',_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'cancelled')));

ALTER TABLE `agent_tool_call`
	ADD CONSTRAINT `ck_agent_tool_call_status` CHECK ((`status` in (_utf8mb4'running',_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'cancelled')));

ALTER TABLE `announcement`
	ADD CONSTRAINT `ck_announcement_level` CHECK ((`level` in (_utf8mb4'normal',_utf8mb4'important')));

ALTER TABLE `announcement`
	ADD CONSTRAINT `ck_announcement_state_fields` CHECK ((((`status` = _utf8mb4'draft') and (`published_at` is null) and (`published_by` is null) and (`unpublished_at` is null) and (`unpublished_by` is null)) or ((`status` = _utf8mb4'published') and (`published_at` is not null) and (`published_by` is not null) and (`unpublished_at` is null) and (`unpublished_by` is null)) or ((`status` = _utf8mb4'unpublished') and (`published_at` is not null) and (`published_by` is not null) and (`unpublished_at` is not null) and (`unpublished_by` is not null))));

ALTER TABLE `announcement`
	ADD CONSTRAINT `ck_announcement_status` CHECK ((`status` in (_utf8mb4'draft',_utf8mb4'published',_utf8mb4'unpublished')));

ALTER TABLE `announcement`
	ADD CONSTRAINT `ck_announcement_window` CHECK (((`ends_at` is null) or (`starts_at` is null) or (`ends_at` > `starts_at`)));

ALTER TABLE `document_parse_task`
	ADD CONSTRAINT `ck_document_parse_task_file_format` CHECK ((`file_format` in (_utf8mb4'md',_utf8mb4'docx',_utf8mb4'pdf',_utf8mb4'txt',_utf8mb4'webm',_utf8mb4'm4a',_utf8mb4'mp3',_utf8mb4'wav',_utf8mb4'ogg',_utf8mb4'mp4',_utf8mb4'mov')));

ALTER TABLE `document_parse_task`
	ADD CONSTRAINT `ck_document_parse_task_lifecycle` CHECK ((((`upload_status` = _utf8mb4'uploading') and (`upload_duration_ms` is null) and (`parse_status` is null) and (`parse_duration_ms` is null)) or ((`upload_status` = _utf8mb4'failed') and (`upload_duration_ms` is not null) and (`parse_status` is null) and (`parse_duration_ms` is null)) or ((`upload_status` = _utf8mb4'succeeded') and (`upload_duration_ms` is not null) and (`parse_status` = _utf8mb4'queued') and (`parse_duration_ms` is null)) or ((`upload_status` = _utf8mb4'succeeded') and (`upload_duration_ms` is not null) and (`parse_status` = _utf8mb4'processing') and (`parse_duration_ms` is null)) or ((`upload_status` = _utf8mb4'succeeded') and (`upload_duration_ms` is not null) and (`parse_status` = _utf8mb4'failed') and (`parse_duration_ms` is not null)) or ((`upload_status` = _utf8mb4'succeeded') and (`upload_duration_ms` is not null) and (`parse_status` = _utf8mb4'succeeded') and (`parse_duration_ms` is not null))));

ALTER TABLE `document_parse_task`
	ADD CONSTRAINT `ck_document_parse_task_parse_status` CHECK (((`parse_status` is null) or (`parse_status` in (_utf8mb4'queued',_utf8mb4'processing',_utf8mb4'succeeded',_utf8mb4'failed'))));

ALTER TABLE `document_parse_task`
	ADD CONSTRAINT `ck_document_parse_task_source_type` CHECK ((`source_type` in (_utf8mb4'resume_import',_utf8mb4'dataset')));

ALTER TABLE `document_parse_task`
	ADD CONSTRAINT `ck_document_parse_task_upload_status` CHECK ((`upload_status` in (_utf8mb4'uploading',_utf8mb4'succeeded',_utf8mb4'failed')));

ALTER TABLE `global_company`
	ADD CONSTRAINT `ck_global_company_company_name_not_blank` CHECK ((length(trim(`company_name`)) > 0));

ALTER TABLE `global_company`
	ADD CONSTRAINT `ck_global_company_normalized_name_not_blank` CHECK ((length(trim(`normalized_name`)) > 0));

ALTER TABLE `interview_recording_transcription`
	ADD CONSTRAINT `ck_interview_recording_transcription_is_pending_replace` CHECK ((`is_pending_replace` in (0,1)));

ALTER TABLE `interview_recording_transcription`
	ADD CONSTRAINT `ck_interview_recording_transcription_status` CHECK ((`status` in (_utf8mb4'queued',_utf8mb4'running',_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'cancelled')));

ALTER TABLE `interview_review_question_note`
	ADD CONSTRAINT `ck_interview_review_question_note_verdict` CHECK (((`verdict` is null) or (`verdict` in (_utf8mb4'good',_utf8mb4'improve'))));

ALTER TABLE `interview_session`
	ADD CONSTRAINT `ck_interview_session_answer_plan` CHECK ((((`schedule_kind` = _utf8mb4'fixed_slot') and (`answer_plan_start_at` is null) and (`answer_plan_end_at` is null)) or ((`schedule_kind` = _utf8mb4'open_window') and (((`answer_plan_start_at` is null) and (`answer_plan_end_at` is null)) or ((`answer_plan_start_at` is not null) and (`answer_plan_end_at` is not null) and (`answer_plan_end_at` > `answer_plan_start_at`) and (`answer_plan_start_at` >= `start_at`) and (`answer_plan_end_at` <= `end_at`))))));

ALTER TABLE `interview_session`
	ADD CONSTRAINT `ck_interview_session_lifecycle` CHECK ((((`status` = _utf8mb4'scheduled') and (`completed_at` is null) and (`cancelled_at` is null)) or ((`status` = _utf8mb4'completed') and (`completed_at` is not null) and (`cancelled_at` is null)) or ((`status` = _utf8mb4'cancelled') and (`completed_at` is null) and (`cancelled_at` is not null) and (`round_result` = _utf8mb4'pending'))));

ALTER TABLE `interview_session`
	ADD CONSTRAINT `ck_interview_session_lock_version` CHECK ((`lock_version` >= 1));

ALTER TABLE `interview_session`
	ADD CONSTRAINT `ck_interview_session_mode` CHECK ((`mode` in (_utf8mb4'video',_utf8mb4'onsite',_utf8mb4'phone',_utf8mb4'other')));

ALTER TABLE `interview_session`
	ADD CONSTRAINT `ck_interview_session_reminder_minutes` CHECK (((`reminder_minutes` is null) or (`reminder_minutes` <= 10080)));

ALTER TABLE `interview_session`
	ADD CONSTRAINT `ck_interview_session_round_result` CHECK ((`round_result` in (_utf8mb4'pending',_utf8mb4'passed',_utf8mb4'rejected')));

ALTER TABLE `interview_session`
	ADD CONSTRAINT `ck_interview_session_schedule_kind` CHECK ((`schedule_kind` in (_utf8mb4'fixed_slot',_utf8mb4'open_window')));

ALTER TABLE `interview_session`
	ADD CONSTRAINT `ck_interview_session_stage_context` CHECK ((((`stage_type` = _utf8mb4'interview') and (`round_no` >= 1)) or ((`stage_type` <> _utf8mb4'interview') and (`round_no` is null))));

ALTER TABLE `interview_session`
	ADD CONSTRAINT `ck_interview_session_stage_type` CHECK ((`stage_type` in (_utf8mb4'interview',_utf8mb4'hr',_utf8mb4'offer',_utf8mb4'other')));

ALTER TABLE `interview_session`
	ADD CONSTRAINT `ck_interview_session_status` CHECK ((`status` in (_utf8mb4'scheduled',_utf8mb4'completed',_utf8mb4'cancelled')));

ALTER TABLE `interview_session`
	ADD CONSTRAINT `ck_interview_session_time_range` CHECK ((`end_at` > `start_at`));

ALTER TABLE `interview_session`
	ADD CONSTRAINT `ck_interview_session_transcript_source` CHECK (((`transcript_source` is null) or (`transcript_source` in (_utf8mb4'manual',_utf8mb4'transcription'))));

ALTER TABLE `job_application_stage`
	ADD CONSTRAINT `ck_job_application_stage_completed_context` CHECK ((((`stage_status` = _utf8mb4'completed') and (`completed_at` is not null)) or (`stage_status` <> _utf8mb4'completed')));

ALTER TABLE `job_application_stage`
	ADD CONSTRAINT `ck_job_application_stage_current_context` CHECK ((((`current_marker` = 1) and (`stage_status` = _utf8mb4'active') and (`completed_at` is null)) or (`current_marker` is null)));

ALTER TABLE `job_application_stage`
	ADD CONSTRAINT `ck_job_application_stage_result` CHECK ((`stage_result` in (_utf8mb4'pending',_utf8mb4'passed',_utf8mb4'rejected',_utf8mb4'skipped')));

ALTER TABLE `job_application_stage`
	ADD CONSTRAINT `ck_job_application_stage_round_context` CHECK (((length(trim(`stage_label`)) > 0) and (((`stage_type` = _utf8mb4'interview') and ((`interview_round_no` is null) or (`interview_round_no` >= 1))) or ((`stage_type` <> _utf8mb4'interview') and (`interview_round_no` is null)))));

ALTER TABLE `job_application_stage`
	ADD CONSTRAINT `ck_job_application_stage_status` CHECK ((`stage_status` in (_utf8mb4'active',_utf8mb4'completed',_utf8mb4'cancelled')));

ALTER TABLE `job_application_stage`
	ADD CONSTRAINT `ck_job_application_stage_stage_type` CHECK ((`stage_type` in (_utf8mb4'screening',_utf8mb4'assessment',_utf8mb4'written_test',_utf8mb4'ai_interview',_utf8mb4'interview',_utf8mb4'hr',_utf8mb4'oc',_utf8mb4'offer')));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_calendar_color` CHECK ((`calendar_color` in (_utf8mb4'red',_utf8mb4'orange',_utf8mb4'yellow',_utf8mb4'green',_utf8mb4'blue',_utf8mb4'purple',_utf8mb4'gray')));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_is_favorite` CHECK ((`is_favorite` in (0,1)));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_job_snapshot_object` CHECK ((json_type(`job_snapshot`) = _utf8mb4'OBJECT'));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_lifecycle_status` CHECK ((`lifecycle_status` in (_utf8mb4'active',_utf8mb4'terminated')));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_lock_version` CHECK ((`lock_version` >= 1));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_offer_salary_context` CHECK (((`offer_salary` is null) or ((`offer_salary_currency` is not null) and (`offer_salary_period` is not null))));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_offer_salary_currency` CHECK (((`offer_salary_currency` is null) or (length(`offer_salary_currency`) = 3)));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_offer_salary_period` CHECK (((`offer_salary_period` is null) or (`offer_salary_period` in (_utf8mb4'hour',_utf8mb4'day',_utf8mb4'month',_utf8mb4'year'))));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_offer_status` CHECK ((`offer_status` in (_utf8mb4'none',_utf8mb4'received',_utf8mb4'accepted',_utf8mb4'declined')));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_round_context` CHECK ((((`current_stage_type` = _utf8mb4'interview') and (`current_round_no` >= 1)) or ((`current_stage_type` <> _utf8mb4'interview') and (`current_round_no` is null))));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_snapshots_not_blank` CHECK (((length(trim(`company_name_snapshot`)) > 0) and (length(trim(`job_title_snapshot`)) > 0) and (length(trim(`current_stage_label`)) > 0)));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_stage_state` CHECK ((`stage_state` in (_utf8mb4'awaiting_schedule',_utf8mb4'scheduled',_utf8mb4'awaiting_result',_utf8mb4'negotiating')));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_stage_type` CHECK ((`current_stage_type` in (_utf8mb4'screening',_utf8mb4'interview',_utf8mb4'hr',_utf8mb4'offer')));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_status` CHECK ((`status` in (_utf8mb4'active',_utf8mb4'rejected',_utf8mb4'withdrawn',_utf8mb4'closed')));

ALTER TABLE `job_application`
	ADD CONSTRAINT `ck_job_application_termination_context` CHECK ((((`lifecycle_status` = _utf8mb4'active') and (`terminated_at` is null) and (`termination_reason` is null)) or ((`lifecycle_status` = _utf8mb4'terminated') and (`terminated_at` is not null) and (`termination_reason` is not null))));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_company_name_not_blank` CHECK ((length(trim(`company_name`)) > 0));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_employment_type` CHECK (((`employment_type` is null) or (`employment_type` in (_utf8mb4'internship',_utf8mb4'campus',_utf8mb4'full_time'))));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_job_title_not_blank` CHECK ((length(trim(`job_title`)) > 0));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_lock_version` CHECK ((`lock_version` >= 1));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_salary_context` CHECK ((((`salary_min` is null) and (`salary_max` is null)) or ((`salary_currency` is not null) and (`salary_period` is not null))));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_salary_currency` CHECK (((`salary_currency` is null) or (length(`salary_currency`) = 3)));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_salary_max` CHECK (((`salary_max` is null) or (`salary_max` >= 0)));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_salary_min` CHECK (((`salary_min` is null) or (`salary_min` >= 0)));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_salary_months` CHECK (((`salary_months_per_year` is null) or (`salary_months_per_year` >= 1)));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_salary_period` CHECK (((`salary_period` is null) or (`salary_period` in (_utf8mb4'hour',_utf8mb4'day',_utf8mb4'month',_utf8mb4'year'))));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_salary_range` CHECK (((`salary_min` is null) or (`salary_max` is null) or (`salary_max` >= `salary_min`)));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_skills_array` CHECK ((json_type(`skills`) = _utf8mb4'ARRAY'));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_source_fields` CHECK (((((`source_url` is null) and (`source_url_hash` is null) and (`source_site` is null) and (`source_job_id` is null)) or ((`source_url` is not null) and (`source_url_hash` is not null) and (`source_site` is not null))) and ((`source_job_id` is null) or (`source_site` is not null)) and (((`source_type` = _utf8mb4'external_import') and (`source_url` is not null) and (`source_site` is not null) and (`source_url_hash` is not null) and (`imported_at` is not null)) or ((`source_type` = _utf8mb4'manual') and (`imported_at` is null)))));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_source_type` CHECK ((`source_type` in (_utf8mb4'manual',_utf8mb4'external_import')));

ALTER TABLE `job_description`
	ADD CONSTRAINT `ck_job_description_work_mode` CHECK (((`work_mode` is null) or (`work_mode` in (_utf8mb4'onsite',_utf8mb4'hybrid',_utf8mb4'remote'))));

ALTER TABLE `job_resume_match`
	ADD CONSTRAINT `ck_job_resume_match_ready` CHECK (((`status` = _utf8mb4'ready') = ((`score` is not null) and (`result_json` is not null))));

ALTER TABLE `job_resume_match`
	ADD CONSTRAINT `ck_job_resume_match_score` CHECK (((`score` is null) or (`score` <= 100)));

ALTER TABLE `job_resume_match`
	ADD CONSTRAINT `ck_job_resume_match_source` CHECK ((`source` in (_utf8mb4'auto',_utf8mb4'manual')));

ALTER TABLE `job_resume_match`
	ADD CONSTRAINT `ck_job_resume_match_status` CHECK ((`status` in (_utf8mb4'pending',_utf8mb4'ready',_utf8mb4'failed')));

ALTER TABLE `llm_model`
	ADD CONSTRAINT `ck_llm_model_is_user_selectable` CHECK ((`is_user_selectable` in (0,1)));

ALTER TABLE `llm_use_case_route`
	ADD CONSTRAINT `ck_llm_use_case_route_is_enabled` CHECK ((`is_enabled` in (0,1)));

ALTER TABLE `mock_interview_question`
	ADD CONSTRAINT `ck_mock_interview_question_answer` CHECK ((((`answer_status` = _utf8mb4'pending') and (`answer_text` is null) and (`answered_at` is null)) or ((`answer_status` = _utf8mb4'answered') and (`answer_text` is not null) and (`answered_at` is not null)) or ((`answer_status` = _utf8mb4'skipped') and (`answer_text` is null) and (`answered_at` is not null))));

ALTER TABLE `mock_interview_question`
	ADD CONSTRAINT `ck_mock_interview_question_answer_source` CHECK (((`answer_source` is null) or (`answer_source` in (_utf8mb4'text',_utf8mb4'voice_input',_utf8mb4'voice'))));

ALTER TABLE `mock_interview_question`
	ADD CONSTRAINT `ck_mock_interview_question_answer_status` CHECK ((`answer_status` in (_utf8mb4'pending',_utf8mb4'answered',_utf8mb4'skipped')));

ALTER TABLE `mock_interview_question`
	ADD CONSTRAINT `ck_mock_interview_question_depth` CHECK ((`depth_level` between 1 and 5));

ALTER TABLE `mock_interview_question`
	ADD CONSTRAINT `ck_mock_interview_question_transcript_state` CHECK (((`transcript_state` is null) or (`transcript_state` in (_utf8mb4'original',_utf8mb4'corrected',_utf8mb4'correction_rejected',_utf8mb4'edited'))));

ALTER TABLE `mock_interview`
	ADD CONSTRAINT `ck_mock_interview_answer_mode` CHECK ((`answer_mode` in (_utf8mb4'text',_utf8mb4'voice')));

ALTER TABLE `mock_interview`
	ADD CONSTRAINT `ck_mock_interview_difficulty` CHECK ((`difficulty` in (_utf8mb4'junior',_utf8mb4'intermediate',_utf8mb4'senior')));

ALTER TABLE `mock_interview`
	ADD CONSTRAINT `ck_mock_interview_is_follow_up_enabled` CHECK ((`is_follow_up_enabled` in (0,1)));

ALTER TABLE `mock_interview`
	ADD CONSTRAINT `ck_mock_interview_is_low_confidence` CHECK ((`is_low_confidence` in (0,1)));

ALTER TABLE `mock_interview`
	ADD CONSTRAINT `ck_mock_interview_is_materials_in_questions` CHECK ((`is_materials_in_questions` in (0,1)));

ALTER TABLE `mock_interview`
	ADD CONSTRAINT `ck_mock_interview_language` CHECK ((`language` in (_utf8mb4'zh',_utf8mb4'en')));

ALTER TABLE `mock_interview`
	ADD CONSTRAINT `ck_mock_interview_lock_version` CHECK ((`lock_version` >= 1));

ALTER TABLE `mock_interview`
	ADD CONSTRAINT `ck_mock_interview_question_count` CHECK ((`question_count` between 3 and 10));

ALTER TABLE `mock_interview`
	ADD CONSTRAINT `ck_mock_interview_score` CHECK (((`total_score` is null) or ((`total_score` >= 0) and (`total_score` <= 100))));

ALTER TABLE `mock_interview`
	ADD CONSTRAINT `ck_mock_interview_source_type` CHECK ((`source_type` in (_utf8mb4'job_application',_utf8mb4'resume')));

ALTER TABLE `mock_interview`
	ADD CONSTRAINT `ck_mock_interview_status` CHECK ((`status` in (_utf8mb4'preparing',_utf8mb4'preparation_failed',_utf8mb4'in_progress',_utf8mb4'evaluating',_utf8mb4'evaluation_failed',_utf8mb4'completed',_utf8mb4'abandoned')));

ALTER TABLE `mock_interview`
	ADD CONSTRAINT `ck_mock_interview_type` CHECK ((`interview_type` in (_utf8mb4'technical',_utf8mb4'project_deep_dive',_utf8mb4'hr',_utf8mb4'comprehensive')));

ALTER TABLE `product_event`
	ADD CONSTRAINT `ck_product_event_name` CHECK ((`event_name` in (_utf8mb4'user_registered',_utf8mb4'resume_created',_utf8mb4'ai_customization_applied',_utf8mb4'mock_interview_completed',_utf8mb4'resume_pdf_exported')));

ALTER TABLE `resume_change_proposal`
	ADD CONSTRAINT `ck_resume_change_proposal_lock_versions` CHECK (((`base_lock_version` >= 1) and ((`applied_lock_version` is null) or (`applied_lock_version` >= `base_lock_version`))));

ALTER TABLE `resume_change_proposal`
	ADD CONSTRAINT `ck_resume_change_proposal_mode` CHECK ((`proposal_mode` in (_utf8mb4'legacy_snapshot',_utf8mb4'polish_local',_utf8mb4'rewrite_entry_star',_utf8mb4'generate_from_materials',_utf8mb4'translate_resume')));

ALTER TABLE `resume_change_proposal`
	ADD CONSTRAINT `ck_resume_change_proposal_status` CHECK ((`status` in (_utf8mb4'pending',_utf8mb4'applied',_utf8mb4'rejected',_utf8mb4'expired',_utf8mb4'conflicted')));

ALTER TABLE `resume_change_proposal`
	ADD CONSTRAINT `ck_resume_change_proposal_translation_result` CHECK ((((`proposal_mode` = _utf8mb4'translate_resume') and (((`status` = _utf8mb4'applied') and (`result_resume_id` is not null)) or ((`status` <> _utf8mb4'applied') and (`result_resume_id` is null)))) or ((`proposal_mode` <> _utf8mb4'translate_resume') and (`proposed_title` is null) and (`result_resume_id` is null))));

ALTER TABLE `resume_template`
	ADD CONSTRAINT `ck_resume_template_is_active` CHECK ((`is_active` in (0,1)));

ALTER TABLE `resume_template`
	ADD CONSTRAINT `ck_resume_template_sort_order` CHECK ((`sort_order` between 0 and 1000000));

ALTER TABLE `resume`
	ADD CONSTRAINT `ck_resume_creation_request_pair` CHECK ((((`creation_request_id` is null) and (`creation_request_hash` is null)) or ((`creation_request_id` is not null) and (`creation_request_hash` is not null))));

ALTER TABLE `resume`
	ADD CONSTRAINT `ck_resume_is_share_allow_download` CHECK ((`is_share_allow_download` in (0,1)));

ALTER TABLE `resume`
	ADD CONSTRAINT `ck_resume_lock_version` CHECK ((`lock_version` >= 1));

ALTER TABLE `resume`
	ADD CONSTRAINT `ck_resume_share_fields` CHECK ((((`share_token` is null) and (`share_visibility` is null) and (`share_created_at` is null)) or ((`share_token` is not null) and (`share_visibility` is not null) and (`share_created_at` is not null))));

ALTER TABLE `resume`
	ADD CONSTRAINT `ck_resume_share_visibility` CHECK (((`share_visibility` is null) or (`share_visibility` in (_utf8mb4'private',_utf8mb4'public'))));

ALTER TABLE `resume`
	ADD CONSTRAINT `ck_resume_source_type` CHECK ((`source_type` in (_utf8mb4'blank',_utf8mb4'template',_utf8mb4'import')));

ALTER TABLE `resume`
	ADD CONSTRAINT `ck_resume_title_not_blank` CHECK ((char_length(trim(`title`)) > 0));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_campus_experiences_array` CHECK ((lower(json_type(`campus_experiences`)) = _utf8mb4'array'));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_candidate_cities_array` CHECK ((lower(json_type(`candidate_cities`)) = _utf8mb4'array'));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_candidate_experience_context` CHECK ((((`candidate_status` is null) and (`graduation_year` is null)) or ((`candidate_status` is not null) and (`candidate_status` = _utf8mb4'fresh_graduate') and (`graduation_year` is not null) and (`years_experience` is not null) and (`years_experience` = 0)) or ((`candidate_status` is not null) and (`candidate_status` = _utf8mb4'experienced') and (`graduation_year` is null))));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_candidate_status` CHECK (((`candidate_status` is null) or (`candidate_status` in (_utf8mb4'fresh_graduate',_utf8mb4'experienced'))));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_certifications_array` CHECK ((lower(json_type(`certifications`)) = _utf8mb4'array'));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_education_level` CHECK (((`education_level` is null) or (`education_level` in (_utf8mb4'high_school',_utf8mb4'junior_college',_utf8mb4'bachelor',_utf8mb4'master',_utf8mb4'doctor'))));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_employment_types_array` CHECK ((lower(json_type(`employment_types`)) = _utf8mb4'array'));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_graduation_year` CHECK (((`graduation_year` is null) or (`graduation_year` between 1900 and 9999)));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_honors_array` CHECK ((lower(json_type(`honors`)) = _utf8mb4'array'));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_languages_array` CHECK ((lower(json_type(`languages`)) = _utf8mb4'array'));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_lock_version` CHECK ((`lock_version` >= 1));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_salary_context` CHECK ((((`salary_min` is null) and (`salary_max` is null)) or ((`salary_currency` is not null) and (`salary_period` is not null))));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_salary_currency` CHECK (((`salary_currency` is null) or (length(`salary_currency`) = 3)));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_salary_period` CHECK (((`salary_period` is null) or (`salary_period` in (_utf8mb4'hour',_utf8mb4'day',_utf8mb4'month',_utf8mb4'year'))));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_salary_range` CHECK (((`salary_min` is null) or (`salary_max` is null) or (`salary_max` >= `salary_min`)));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_school_tier_array` CHECK ((lower(json_type(`school_tier`)) = _utf8mb4'array'));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_skills_array` CHECK ((lower(json_type(`skills`)) = _utf8mb4'array'));

ALTER TABLE `user_profile`
	ADD CONSTRAINT `ck_user_profile_years_experience` CHECK (((`years_experience` is null) or (`years_experience` >= 0)));

ALTER TABLE `user`
	ADD CONSTRAINT `ck_user_is_admin` CHECK ((`is_admin` in (0,1)));

ALTER TABLE `user`
	ADD CONSTRAINT `ck_user_status` CHECK ((`status` in (0,1)));
