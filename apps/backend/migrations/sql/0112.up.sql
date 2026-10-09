-- 0112: rename yes/no columns to is_xxx and store them as tinyint unsigned (1 yes, 0 no).
-- Values and defaults are unchanged; llm_model_routes.target_available keeps NULL as "not probed".
-- MySQL refuses to rename a column referenced by a CHECK constraint, so those checks are
-- dropped first and recreated under the new column name.

ALTER TABLE `account_preferences`
	DROP CHECK `ck_account_preferences_reminder`;

ALTER TABLE `account_preferences`
	CHANGE COLUMN `interview_reminder_enabled` `is_interview_reminder_enabled` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '是否开启面试提醒：1 是，0 否；当前不发送通知',
	ADD CONSTRAINT `ck_account_preferences_is_interview_reminder_enabled` CHECK (`is_interview_reminder_enabled` IN (0, 1));

ALTER TABLE `agent_sessions`
	CHANGE COLUMN `pinned` `is_pinned` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '是否置顶：1 是，0 否',
	ADD CONSTRAINT `ck_agent_sessions_is_pinned` CHECK (`is_pinned` IN (0, 1)),
	RENAME INDEX `idx_agent_sessions_user_pinned_updated` TO `idx_agent_sessions_user_is_pinned_updated`;

ALTER TABLE `interview_recording_transcriptions`
	CHANGE COLUMN `pending_replace` `is_pending_replace` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '结果未写入场次、等待用户替换：1 是，0 否',
	ADD CONSTRAINT `ck_interview_recording_transcriptions_is_pending_replace` CHECK (`is_pending_replace` IN (0, 1));

ALTER TABLE `llm_model_routes`
	CHANGE COLUMN `target_available` `is_target_available` tinyint unsigned NULL DEFAULT NULL COMMENT '上游目标是否可用：1 是，0 否，NULL 尚未探测',
	CHANGE COLUMN `enabled` `is_enabled` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '是否启用：1 是，0 否',
	ADD CONSTRAINT `ck_llm_routes_is_target_available` CHECK (`is_target_available` IS NULL OR `is_target_available` IN (0, 1)),
	ADD CONSTRAINT `ck_llm_routes_is_enabled` CHECK (`is_enabled` IN (0, 1)),
	RENAME INDEX `idx_llm_routes_model_enabled` TO `idx_llm_routes_model_is_enabled`;

ALTER TABLE `llm_models`
	CHANGE COLUMN `user_selectable` `is_user_selectable` tinyint unsigned NOT NULL DEFAULT '1' COMMENT '对话页是否允许用户选择：1 是，0 否；隐藏的模型不进入列表、不作默认、不可被会话使用',
	ADD CONSTRAINT `ck_llm_models_is_user_selectable` CHECK (`is_user_selectable` IN (0, 1));

ALTER TABLE `llm_provider_connections`
	CHANGE COLUMN `enabled` `is_enabled` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '是否启用：1 是，0 否',
	ADD CONSTRAINT `ck_llm_connections_is_enabled` CHECK (`is_enabled` IN (0, 1));

ALTER TABLE `llm_use_case_routes`
	CHANGE COLUMN `enabled` `is_enabled` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '是否启用：1 是，0 否',
	ADD CONSTRAINT `ck_llm_use_case_routes_is_enabled` CHECK (`is_enabled` IN (0, 1));

ALTER TABLE `mock_interviews`
	CHANGE COLUMN `follow_up_enabled` `is_follow_up_enabled` tinyint unsigned NOT NULL DEFAULT '1' COMMENT '是否开启追问：1 是，0 否',
	CHANGE COLUMN `low_confidence` `is_low_confidence` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '评分是否低置信：1 是，0 否',
	CHANGE COLUMN `materials_in_questions` `is_materials_in_questions` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '出题是否参考所选资料：1 是，0 否；为 0 时资料只用于报告核验',
	ADD CONSTRAINT `ck_mock_interviews_is_follow_up_enabled` CHECK (`is_follow_up_enabled` IN (0, 1)),
	ADD CONSTRAINT `ck_mock_interviews_is_low_confidence` CHECK (`is_low_confidence` IN (0, 1)),
	ADD CONSTRAINT `ck_mock_interviews_is_materials_in_questions` CHECK (`is_materials_in_questions` IN (0, 1));

ALTER TABLE `resumes`
	DROP CHECK `ck_resumes_share_allow_download`;

ALTER TABLE `resumes`
	CHANGE COLUMN `share_allow_download` `is_share_allow_download` tinyint unsigned NOT NULL DEFAULT '1' COMMENT '是否允许通过分享页下载 PDF：1 允许，0 禁止',
	ADD CONSTRAINT `ck_resumes_is_share_allow_download` CHECK (`is_share_allow_download` IN (0, 1));
