-- Upgrade migration for 0110: interview_transcription_and_question_notes
-- One background transcription job per recording linked to an interview session.
CREATE TABLE interview_recording_transcriptions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '所有者',
    session_id BIGINT UNSIGNED NOT NULL COMMENT '录音关联的场次',
    dataset_id BIGINT UNSIGNED NOT NULL COMMENT '录音资料',
    status VARCHAR(16) NOT NULL COMMENT 'queued/running/succeeded/failed/cancelled',
    provider_task_id VARCHAR(128) NULL COMMENT '语音服务任务号',
    attempts INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '提交次数',
    next_attempt_at DATETIME(6) NOT NULL COMMENT '下次提交或查询时间 UTC',
    lease_until DATETIME(6) NULL COMMENT 'worker 租约到期时间 UTC',
    submitted_at DATETIME(6) NULL COMMENT '最近一次提交时间 UTC，用于超时判定',
    result_markdown LONGTEXT NULL COMMENT '转写结果全文（带说话人标签）',
    result_duration_ms INT UNSIGNED NULL COMMENT '识别出的音频时长',
    pending_replace TINYINT(1) NOT NULL DEFAULT 0 COMMENT '结果未写入场次、等待用户替换',
    error_code VARCHAR(64) NULL COMMENT '失败原因码',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
    CONSTRAINT pk_interview_recording_transcriptions PRIMARY KEY (id),
    CONSTRAINT uk_interview_recording_transcriptions_dataset UNIQUE (dataset_id),
    CONSTRAINT fk_interview_recording_transcriptions_session FOREIGN KEY (session_id)
        REFERENCES interview_sessions (id) ON DELETE CASCADE,
    CONSTRAINT fk_interview_recording_transcriptions_dataset FOREIGN KEY (dataset_id)
        REFERENCES user_dataset (id) ON DELETE CASCADE,
    CONSTRAINT fk_interview_recording_transcriptions_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_interview_recording_transcriptions_status CHECK (
        status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
    ),
    INDEX idx_interview_recording_transcriptions_due (status, next_attempt_at),
    INDEX idx_interview_recording_transcriptions_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='面试录音转写任务';

-- Per-question review notes, anchored to the normalized question text.
CREATE TABLE interview_review_question_notes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '所有者',
    session_id BIGINT UNSIGNED NOT NULL COMMENT '场次',
    question_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '题目原文规范化后的 SHA-256',
    question_text VARCHAR(1000) NOT NULL COMMENT '题目原文快照',
    verdict VARCHAR(16) NULL COMMENT 'good/improve，未标记为空',
    note TEXT NULL COMMENT '笔记，最多 2000 字',
    lock_version INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
    CONSTRAINT pk_interview_review_question_notes PRIMARY KEY (id),
    CONSTRAINT uk_interview_review_question_notes_session_key UNIQUE (session_id, question_key),
    CONSTRAINT fk_interview_review_question_notes_session FOREIGN KEY (session_id)
        REFERENCES interview_sessions (id) ON DELETE CASCADE,
    CONSTRAINT fk_interview_review_question_notes_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_interview_review_question_notes_verdict CHECK (
        verdict IS NULL OR verdict IN ('good', 'improve')
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='逐题复盘笔记';

ALTER TABLE interview_sessions
    ADD COLUMN transcript_source VARCHAR(16) NULL COMMENT 'manual/transcription，空表示历史数据',
    ADD COLUMN review_heartbeat_at DATETIME(6) NULL COMMENT 'AI 复盘后台任务心跳 UTC',
    ADD CONSTRAINT ck_interview_sessions_transcript_source CHECK (
        transcript_source IS NULL OR transcript_source IN ('manual', 'transcription')
    );
