-- 0099: LinkRag sync records for dataset materials, and the mock interview
-- switch that lets question generation read the selected materials.
CREATE TABLE user_dataset_rag_sync (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  dataset_id BIGINT UNSIGNED NOT NULL COMMENT 'user_dataset.id；不建外键，资料删除后用于驱动 RAG 删除',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '资料所属用户，亦为 LinkRag X-App-User-Id',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT '同步状态：pending、parsing、ready、failed',
  content_revision BIGINT UNSIGNED NOT NULL COMMENT '期望同步的 user_dataset.content_revision',
  synced_revision BIGINT UNSIGNED NULL COMMENT '当前 rag_file_id 对应的正文修订号',
  rag_file_id BIGINT UNSIGNED NULL COMMENT 'LinkRag 文件 ID；为空表示 RAG 侧无文件',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前修订的失败次数',
  last_error VARCHAR(64) NULL COMMENT '最近一次稳定错误码，不含正文或凭证',
  next_attempt_at DATETIME(6) NULL COMMENT '最早下次处理时间 UTC',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间 UTC',
  CONSTRAINT pk_user_dataset_rag_sync PRIMARY KEY (id),
  CONSTRAINT uk_user_dataset_rag_sync_dataset UNIQUE (dataset_id),
  CONSTRAINT ck_user_dataset_rag_sync_status CHECK (status IN ('pending', 'parsing', 'ready', 'failed')),
  INDEX idx_user_dataset_rag_sync_status (status, next_attempt_at, id),
  INDEX idx_user_dataset_rag_sync_user (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='资料到 LinkRag 向量索引的同步记录';

ALTER TABLE mock_interviews
  ADD COLUMN materials_in_questions BOOL NOT NULL DEFAULT false
    COMMENT '出题是否参考所选资料；false 时资料只用于报告核验';
