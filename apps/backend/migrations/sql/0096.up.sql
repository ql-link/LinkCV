-- 0096: voice answering for AI mock interviews (speech input, voice interviews,
-- transcript correction and single-question re-evaluation).

ALTER TABLE mock_interviews
	ADD COLUMN answer_mode VARCHAR(16) NOT NULL DEFAULT 'text' COMMENT '作答方式：text/voice' AFTER language,
	ADD COLUMN speech_snapshot_json JSON NULL COMMENT '语音识别与合成线路快照' AFTER answer_mode,
	ADD COLUMN hotwords_json JSON NULL COMMENT '本场语音识别热词表' AFTER speech_snapshot_json,
	ADD COLUMN transcript_corrected_at DATETIME(6) NULL COMMENT '整场 AI 修正识别稿的执行时间' AFTER hotwords_json,
	ADD COLUMN recordings_deleted_at DATETIME(6) NULL COMMENT '本场录音被删除的时间' AFTER transcript_corrected_at,
	ADD CONSTRAINT ck_mock_interviews_answer_mode CHECK (answer_mode IN ('text', 'voice'));

ALTER TABLE mock_interview_questions
	ADD COLUMN answer_source VARCHAR(16) NULL COMMENT '作答来源：text/voice_input/voice' AFTER answered_at,
	ADD COLUMN recording_object_name VARCHAR(512) NULL COMMENT '录音对象 key' AFTER answer_source,
	ADD COLUMN audio_duration_ms INT UNSIGNED NULL COMMENT '录音时长（毫秒）' AFTER recording_object_name,
	ADD COLUMN raw_transcript TEXT NULL COMMENT '原始识别稿' AFTER audio_duration_ms,
	ADD COLUMN words_json JSON NULL COMMENT '带时间戳的分词结果' AFTER raw_transcript,
	ADD COLUMN corrected_transcript TEXT NULL COMMENT 'AI 修正稿' AFTER words_json,
	ADD COLUMN correction_json JSON NULL COMMENT 'AI 修正记录' AFTER corrected_transcript,
	ADD COLUMN transcript_state VARCHAR(24) NULL COMMENT '识别稿状态' AFTER correction_json,
	ADD COLUMN manual_edit_count TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '手动修改次数' AFTER transcript_state,
	ADD COLUMN re_evaluate_count TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '单题重新评估次数' AFTER manual_edit_count,
	ADD COLUMN evaluation_history_json JSON NULL COMMENT '历史评估结果与所用文本版本' AFTER re_evaluate_count,
	ADD CONSTRAINT ck_mock_interview_questions_answer_source CHECK (answer_source IS NULL OR answer_source IN ('text', 'voice_input', 'voice')),
	ADD CONSTRAINT ck_mock_interview_questions_transcript_state CHECK (transcript_state IS NULL OR transcript_state IN ('original', 'corrected', 'correction_rejected', 'edited'));
