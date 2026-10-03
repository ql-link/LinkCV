-- Upgrade migration for 0105: complete_account
-- Add reviewed MySQL 8.4 statements below.
ALTER TABLE users
  ADD COLUMN contact_email VARCHAR(254) NULL COMMENT '联系邮箱，不验证归属，不参与登录',
  ADD COLUMN deletion_requested_at DATETIME(6) NULL COMMENT '注销受理时间 UTC';

UPDATE users SET contact_email = email WHERE email IS NOT NULL;

CREATE TABLE account_preferences (
  user_id BIGINT UNSIGNED NOT NULL COMMENT '所属用户',
  locale VARCHAR(5) NOT NULL DEFAULT 'zh-CN' COMMENT '界面语言：zh-CN、en-US',
  interview_reminder_enabled TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '提醒偏好，当前不发送通知',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间 UTC',
  CONSTRAINT pk_account_preferences PRIMARY KEY (user_id),
  CONSTRAINT fk_account_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_account_preferences_locale CHECK (locale IN ('zh-CN', 'en-US')),
  CONSTRAINT ck_account_preferences_reminder CHECK (interview_reminder_enabled IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='账号界面语言与提醒偏好';

CREATE TABLE account_deletion_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '清理任务主键',
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '公开 UUID',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '原用户 ID，无外键',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending、processing、retry_wait、needs_attention、completed',
  phase VARCHAR(16) NOT NULL DEFAULT 'database' COMMENT 'database、objects、rag、complete',
  cleanup_manifest JSON NOT NULL COMMENT '受控清理目标，无个人正文',
  receipt_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '随机回执哈希',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '失败次数',
  last_error_code VARCHAR(64) NULL COMMENT '有限错误码',
  next_attempt_at DATETIME(6) NULL COMMENT '下次执行 UTC',
  lease_until DATETIME(6) NULL COMMENT '执行租约 UTC',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '受理时间 UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间 UTC',
  completed_at DATETIME(6) NULL COMMENT '完成时间 UTC',
  CONSTRAINT pk_account_deletion_jobs PRIMARY KEY (id),
  CONSTRAINT uk_account_deletion_jobs_public UNIQUE (public_id),
  CONSTRAINT uk_account_deletion_jobs_user UNIQUE (user_id),
  CONSTRAINT ck_account_deletion_jobs_status CHECK (status IN ('pending', 'processing', 'retry_wait', 'needs_attention', 'completed')),
  CONSTRAINT ck_account_deletion_jobs_phase CHECK (phase IN ('database', 'objects', 'rag', 'complete')),
  INDEX idx_account_deletion_jobs_due (status, next_attempt_at, id),
  INDEX idx_account_deletion_jobs_completed (status, completed_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='持久账号清理任务';
