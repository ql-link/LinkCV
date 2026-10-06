-- 0113: drop every database foreign key (Alibaba MySQL rule: no foreign keys or cascades).
-- Referential integrity, ownership and delete cleanup are enforced by the application.
-- Indexes MySQL created implicitly for a foreign key keep the fk_ name after the drop;
-- they are renamed to idx_<table>_<column> so lookups on the reference column stay indexed.

ALTER TABLE `account_preferences`
	DROP FOREIGN KEY `fk_account_preferences_user`;

ALTER TABLE `agent_operations`
	DROP FOREIGN KEY `fk_agent_operations_session`;

ALTER TABLE `agent_runs`
	DROP FOREIGN KEY `fk_agent_runs_llm_model`,
	DROP FOREIGN KEY `fk_agent_runs_llm_route`;

ALTER TABLE `agent_runs`
	RENAME INDEX `fk_agent_runs_llm_model` TO `idx_agent_runs_resolved_llm_model_id`,
	RENAME INDEX `fk_agent_runs_llm_route` TO `idx_agent_runs_resolved_llm_route_id`;

ALTER TABLE `agent_sessions`
	DROP FOREIGN KEY `fk_agent_sessions_llm_model`;

ALTER TABLE `agent_sessions`
	RENAME INDEX `fk_agent_sessions_llm_model` TO `idx_agent_sessions_selected_llm_model_id`;

ALTER TABLE `agent_stage_events`
	DROP FOREIGN KEY `fk_agent_stage_events_operation`;

ALTER TABLE `announcement_read_cursors`
	DROP FOREIGN KEY `fk_announcement_read_cursors_user`;

ALTER TABLE `announcements`
	DROP FOREIGN KEY `fk_announcements_created_by`,
	DROP FOREIGN KEY `fk_announcements_published_by`,
	DROP FOREIGN KEY `fk_announcements_unpublished_by`,
	DROP FOREIGN KEY `fk_announcements_updated_by`;

ALTER TABLE `announcements`
	RENAME INDEX `fk_announcements_created_by` TO `idx_announcements_created_by`,
	RENAME INDEX `fk_announcements_published_by` TO `idx_announcements_published_by`,
	RENAME INDEX `fk_announcements_unpublished_by` TO `idx_announcements_unpublished_by`,
	RENAME INDEX `fk_announcements_updated_by` TO `idx_announcements_updated_by`;

ALTER TABLE `document_parse_tasks`
	DROP FOREIGN KEY `fk_document_parse_tasks_selected_template`,
	DROP FOREIGN KEY `fk_document_parse_tasks_user`;

ALTER TABLE `interview_recording_transcriptions`
	DROP FOREIGN KEY `fk_interview_recording_transcriptions_dataset`,
	DROP FOREIGN KEY `fk_interview_recording_transcriptions_session`,
	DROP FOREIGN KEY `fk_interview_recording_transcriptions_user`;

ALTER TABLE `interview_recording_transcriptions`
	RENAME INDEX `fk_interview_recording_transcriptions_user` TO `idx_interview_recording_transcriptions_user_id`;

ALTER TABLE `interview_review_question_notes`
	DROP FOREIGN KEY `fk_interview_review_question_notes_session`,
	DROP FOREIGN KEY `fk_interview_review_question_notes_user`;

ALTER TABLE `interview_review_question_notes`
	RENAME INDEX `fk_interview_review_question_notes_user` TO `idx_interview_review_question_notes_user_id`;

ALTER TABLE `interview_sessions`
	DROP FOREIGN KEY `fk_interview_sessions_application`,
	DROP FOREIGN KEY `fk_interview_sessions_application_stage`;

ALTER TABLE `job_application_offer_materials`
	DROP FOREIGN KEY `fk_offer_material_application`,
	DROP FOREIGN KEY `fk_offer_material_dataset`;

ALTER TABLE `job_application_stages`
	DROP FOREIGN KEY `fk_job_application_stages_application`;

ALTER TABLE `job_applications`
	DROP FOREIGN KEY `fk_job_applications_job_description`,
	DROP FOREIGN KEY `fk_job_applications_resume`,
	DROP FOREIGN KEY `fk_job_applications_user`;

ALTER TABLE `job_descriptions`
	DROP FOREIGN KEY `fk_job_descriptions_user`;

ALTER TABLE `job_resume_matches`
	DROP FOREIGN KEY `fk_job_resume_matches_job`,
	DROP FOREIGN KEY `fk_job_resume_matches_resume`,
	DROP FOREIGN KEY `fk_job_resume_matches_user`;

ALTER TABLE `job_resume_matches`
	RENAME INDEX `fk_job_resume_matches_resume` TO `idx_job_resume_matches_resume_id`;

ALTER TABLE `llm_call_logs`
	DROP FOREIGN KEY `fk_llm_calls_route`,
	DROP FOREIGN KEY `fk_llm_calls_run`,
	DROP FOREIGN KEY `fk_llm_calls_user`;

ALTER TABLE `llm_model_routes`
	DROP FOREIGN KEY `fk_llm_routes_connection`,
	DROP FOREIGN KEY `fk_llm_routes_model`;

ALTER TABLE `llm_use_case_routes`
	DROP FOREIGN KEY `fk_llm_use_case_route`;

ALTER TABLE `mock_interview_questions`
	DROP FOREIGN KEY `fk_mock_interview_questions_interview`,
	DROP FOREIGN KEY `fk_mock_interview_questions_parent`;

ALTER TABLE `mock_interviews`
	DROP FOREIGN KEY `fk_mock_interviews_application`,
	DROP FOREIGN KEY `fk_mock_interviews_job`,
	DROP FOREIGN KEY `fk_mock_interviews_repeat_of`,
	DROP FOREIGN KEY `fk_mock_interviews_resume`,
	DROP FOREIGN KEY `fk_mock_interviews_user`;

ALTER TABLE `product_events`
	DROP FOREIGN KEY `fk_product_events_user`;

ALTER TABLE `resumes`
	DROP FOREIGN KEY `fk_resumes_template`,
	DROP FOREIGN KEY `fk_resumes_user`;

ALTER TABLE `user_dataset`
	DROP FOREIGN KEY `fk_user_dataset_folder`,
	DROP FOREIGN KEY `fk_user_dataset_interview_session`,
	DROP FOREIGN KEY `fk_user_dataset_user`;

ALTER TABLE `user_dataset`
	RENAME INDEX `fk_user_dataset_folder` TO `idx_user_dataset_folder_id`;

ALTER TABLE `user_dataset_folders`
	DROP FOREIGN KEY `fk_user_dataset_folders_user`;

ALTER TABLE `user_profiles`
	DROP FOREIGN KEY `fk_user_profiles_user`;
