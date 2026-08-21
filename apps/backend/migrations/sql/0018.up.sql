-- Up migration for 0018: create user_dataset
CREATE TABLE user_dataset (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '数据集自增主键',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '所属用户 ID',
  file_name VARCHAR(255) NOT NULL COMMENT '原始上传文件名（已安全化）',
  file_format VARCHAR(10) NOT NULL COMMENT '文件格式：docx/pdf/md/txt',
  content_type VARCHAR(128) NOT NULL COMMENT '上传声明的 MIME 类型',
  file_size BIGINT UNSIGNED NOT NULL COMMENT '文件大小（字节）',
  object_name VARCHAR(512) NOT NULL COMMENT '对象存储对象键',
  sha256 CHAR(64) NOT NULL COMMENT '文件内容 SHA-256 十六进制摘要',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
  CONSTRAINT pk_user_dataset PRIMARY KEY (id),
  CONSTRAINT fk_user_dataset_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT uk_user_dataset_object_name UNIQUE (object_name),
  CONSTRAINT ck_user_dataset_file_format
    CHECK (file_format IN ('docx', 'pdf', 'md', 'txt')),
  KEY idx_user_dataset_user_created (user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='用户知识库数据集';
