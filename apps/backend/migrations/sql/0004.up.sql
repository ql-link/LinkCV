-- Up migration for 0004: add storage cleanup jobs
CREATE TABLE storage_cleanup_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '清理任务自增主键',
  operation VARCHAR(16) NOT NULL COMMENT '删除类型：object 或 prefix',
  object_key VARCHAR(512) NOT NULL COMMENT '待删除对象键或对象键前缀',
  attempts INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已失败尝试次数',
  last_error_type VARCHAR(128) NULL DEFAULT NULL COMMENT '最近失败异常类型',
  last_attempt_at DATETIME(6) NULL DEFAULT NULL COMMENT '最近尝试时间（UTC）',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间（UTC）',
  CONSTRAINT pk_storage_cleanup_jobs PRIMARY KEY (id),
  CONSTRAINT uk_storage_cleanup_jobs_target UNIQUE (operation, object_key),
  CONSTRAINT ck_storage_cleanup_jobs_operation
    CHECK (operation IN ('object', 'prefix')),
  CONSTRAINT ck_storage_cleanup_jobs_attempts CHECK (attempts >= 0),
  KEY idx_storage_cleanup_jobs_created_id (created_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='对象存储删除补偿任务';
