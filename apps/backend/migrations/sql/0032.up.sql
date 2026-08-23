-- Up migration for 0032: persistent interview center applications, sessions and assets.

CREATE TABLE job_applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '求职进程自增主键',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '求职进程所有者',
  job_description_id BIGINT UNSIGNED NULL COMMENT '来源 JD，删除后解除引用',
  resume_version_id BIGINT UNSIGNED NULL COMMENT '本次投递使用的不可变简历版本',
  company_name_snapshot VARCHAR(200) NOT NULL COMMENT '建立进程时的公司名快照',
  job_title_snapshot VARCHAR(200) NOT NULL COMMENT '建立进程时的岗位名快照',
  job_snapshot JSON NOT NULL COMMENT 'schema_version=1 的完整岗位业务快照',
  resume_title_snapshot VARCHAR(255) NULL COMMENT '投递简历标题快照',
  calendar_color VARCHAR(16) NOT NULL COMMENT 'Mac 日历语义颜色',
  current_stage_type VARCHAR(24) NOT NULL COMMENT 'screening、interview、hr 或 offer',
  current_round_no SMALLINT UNSIGNED NULL COMMENT '普通面试轮次',
  current_stage_label VARCHAR(100) NOT NULL COMMENT '筛选中、一面、二面、HR 面等',
  stage_state VARCHAR(24) NOT NULL COMMENT '待安排、已排期、等待结果或协商中',
  status VARCHAR(24) NOT NULL DEFAULT 'active' COMMENT 'active、rejected、withdrawn 或 closed',
  offer_status VARCHAR(32) NOT NULL DEFAULT 'none' COMMENT 'OC、书面 Offer 与最终结果',
  is_favorite TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否关注',
  applied_at DATETIME(6) NULL COMMENT '实际投递时间 UTC',
  notes TEXT NULL COMMENT '求职进程级备注',
  archived_at DATETIME(6) NULL COMMENT '归档时间 UTC',
  lock_version INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间 UTC',
  CONSTRAINT pk_job_applications PRIMARY KEY (id),
  CONSTRAINT fk_job_applications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_job_applications_job_description FOREIGN KEY (job_description_id) REFERENCES job_descriptions (id) ON DELETE SET NULL,
  CONSTRAINT fk_job_applications_resume_version FOREIGN KEY (resume_version_id) REFERENCES resume_versions (id) ON DELETE SET NULL,
  CONSTRAINT ck_job_applications_snapshots_not_blank CHECK (
    LENGTH(TRIM(company_name_snapshot)) > 0
    AND LENGTH(TRIM(job_title_snapshot)) > 0
    AND LENGTH(TRIM(current_stage_label)) > 0
  ),
  CONSTRAINT ck_job_applications_job_snapshot_object CHECK (JSON_TYPE(job_snapshot) = 'OBJECT'),
  CONSTRAINT ck_job_applications_calendar_color CHECK (calendar_color IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray')),
  CONSTRAINT ck_job_applications_stage_type CHECK (current_stage_type IN ('screening', 'interview', 'hr', 'offer')),
  CONSTRAINT ck_job_applications_round_context CHECK (
    (current_stage_type = 'interview' AND current_round_no >= 1)
    OR (current_stage_type <> 'interview' AND current_round_no IS NULL)
  ),
  CONSTRAINT ck_job_applications_stage_state CHECK (stage_state IN ('awaiting_schedule', 'scheduled', 'awaiting_result', 'negotiating')),
  CONSTRAINT ck_job_applications_status CHECK (status IN ('active', 'rejected', 'withdrawn', 'closed')),
  CONSTRAINT ck_job_applications_offer_status CHECK (offer_status IN ('none', 'oc_received', 'written_offer_received', 'accepted', 'declined')),
  CONSTRAINT ck_job_applications_is_favorite CHECK (is_favorite IN (0, 1)),
  CONSTRAINT ck_job_applications_lock_version CHECK (lock_version >= 1),
  INDEX idx_job_applications_user_scope_updated (user_id, archived_at, status, updated_at DESC, id DESC),
  INDEX idx_job_applications_user_stage (user_id, archived_at, status, current_stage_type, current_round_no, stage_state),
  INDEX idx_job_applications_user_offer (user_id, archived_at, offer_status),
  INDEX idx_job_applications_job_description (job_description_id),
  INDEX idx_job_applications_resume_version (resume_version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户一次完整求职尝试';

CREATE TABLE interview_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '单场面试自增主键',
  application_id BIGINT UNSIGNED NOT NULL COMMENT '所属求职进程',
  client_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '客户端创建请求 UUID',
  stage_type VARCHAR(24) NOT NULL COMMENT 'interview、hr、offer 或 other',
  round_no SMALLINT UNSIGNED NULL COMMENT '普通面试轮次',
  stage_label VARCHAR(100) NOT NULL COMMENT '一面、技术二面、HR 面等展示名称',
  status VARCHAR(24) NOT NULL DEFAULT 'scheduled' COMMENT 'scheduled、completed 或 cancelled',
  round_result VARCHAR(24) NOT NULL DEFAULT 'pending' COMMENT 'pending、passed 或 rejected',
  start_at DATETIME(6) NOT NULL COMMENT '计划开始时间 UTC',
  end_at DATETIME(6) NOT NULL COMMENT '计划结束时间 UTC',
  timezone VARCHAR(64) NOT NULL COMMENT '排期时使用的 IANA 时区',
  mode VARCHAR(24) NOT NULL COMMENT 'video、onsite、phone 或 other',
  meeting_url VARCHAR(2048) NULL COMMENT '线上会议链接',
  location VARCHAR(500) NULL COMMENT '现场地址或补充地点',
  interviewer_name VARCHAR(100) NULL COMMENT '面试官姓名',
  interviewer_title VARCHAR(100) NULL COMMENT '面试官职位或身份',
  reminder_minutes SMALLINT UNSIGNED NULL COMMENT '提前提醒分钟数，本期仅保存',
  preparation_note TEXT NULL COMMENT '面试前准备和备注',
  questions_markdown LONGTEXT NULL COMMENT '用户原始题目记录 Markdown',
  review_summary LONGTEXT NULL COMMENT '用户原始复盘总结',
  improvement_markdown LONGTEXT NULL COMMENT '用户原始改进点 Markdown',
  completed_at DATETIME(6) NULL COMMENT '用户确认完成时间 UTC',
  cancelled_at DATETIME(6) NULL COMMENT '用户确认取消时间 UTC',
  cancellation_reason VARCHAR(500) NULL COMMENT '取消原因',
  lock_version INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间 UTC',
  CONSTRAINT pk_interview_sessions PRIMARY KEY (id),
  CONSTRAINT fk_interview_sessions_application FOREIGN KEY (application_id) REFERENCES job_applications (id) ON DELETE RESTRICT,
  CONSTRAINT uk_interview_sessions_application_request UNIQUE (application_id, client_request_id),
  CONSTRAINT ck_interview_sessions_stage_type CHECK (stage_type IN ('interview', 'hr', 'offer', 'other')),
  CONSTRAINT ck_interview_sessions_stage_context CHECK (
    (stage_type = 'interview' AND round_no >= 1)
    OR (stage_type <> 'interview' AND round_no IS NULL)
  ),
  CONSTRAINT ck_interview_sessions_status CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  CONSTRAINT ck_interview_sessions_round_result CHECK (round_result IN ('pending', 'passed', 'rejected')),
  CONSTRAINT ck_interview_sessions_time_range CHECK (end_at > start_at),
  CONSTRAINT ck_interview_sessions_mode CHECK (mode IN ('video', 'onsite', 'phone', 'other')),
  CONSTRAINT ck_interview_sessions_lifecycle CHECK (
    (status = 'scheduled' AND completed_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND completed_at IS NULL AND cancelled_at IS NOT NULL AND round_result = 'pending')
  ),
  CONSTRAINT ck_interview_sessions_reminder_minutes CHECK (reminder_minutes IS NULL OR reminder_minutes <= 10080),
  CONSTRAINT ck_interview_sessions_lock_version CHECK (lock_version >= 1),
  INDEX idx_interview_sessions_application_time (application_id, start_at, end_at, id),
  INDEX idx_interview_sessions_application_status_time (application_id, status, start_at, id),
  INDEX idx_interview_sessions_application_completed (application_id, status, completed_at DESC, id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='排期与复盘共用的单场面试';

CREATE TABLE interview_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '面试素材自增主键',
  interview_session_id BIGINT UNSIGNED NOT NULL COMMENT '所属单场面试',
  source_type VARCHAR(24) NOT NULL COMMENT 'recorded 或 uploaded',
  asset_type VARCHAR(24) NOT NULL COMMENT 'audio、video 或 document',
  original_file_name VARCHAR(255) NOT NULL COMMENT '安全化后的原始文件名',
  content_type VARCHAR(128) NOT NULL COMMENT '规范化 MIME 类型',
  file_size BIGINT UNSIGNED NOT NULL COMMENT '对象字节数',
  duration_ms BIGINT UNSIGNED NULL COMMENT '音视频时长毫秒',
  object_name VARCHAR(512) NOT NULL COMMENT 'MinIO 私有对象键',
  sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '文件 SHA-256',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  CONSTRAINT pk_interview_assets PRIMARY KEY (id),
  CONSTRAINT fk_interview_assets_session FOREIGN KEY (interview_session_id) REFERENCES interview_sessions (id) ON DELETE RESTRICT,
  CONSTRAINT uk_interview_assets_object_name UNIQUE (object_name),
  CONSTRAINT ck_interview_assets_source_type CHECK (source_type IN ('recorded', 'uploaded')),
  CONSTRAINT ck_interview_assets_asset_type CHECK (asset_type IN ('audio', 'video', 'document')),
  CONSTRAINT ck_interview_assets_file_size CHECK (file_size > 0),
  CONSTRAINT ck_interview_assets_duration_ms CHECK (duration_ms IS NULL OR duration_ms > 0),
  CONSTRAINT ck_interview_assets_sha256 CHECK (sha256 IS NULL OR LENGTH(sha256) = 64),
  INDEX idx_interview_assets_session_created (interview_session_id, created_at DESC, id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='面试录音、视频与文档素材';
