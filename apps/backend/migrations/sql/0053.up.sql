-- Up migration for 0053: add user dataset folders
CREATE TABLE user_dataset_folders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '文件夹自增主键',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '所属用户 ID',
  name VARCHAR(64) NOT NULL COMMENT '文件夹名称',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）',
  CONSTRAINT pk_user_dataset_folders PRIMARY KEY (id),
  CONSTRAINT fk_user_dataset_folders_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT uk_user_dataset_folders_user_name UNIQUE (user_id, name),
  KEY idx_user_dataset_folders_user_created (user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='用户资料分类文件夹';

ALTER TABLE user_dataset
  ADD COLUMN folder_id BIGINT UNSIGNED NULL
    COMMENT '所属文件夹 ID，为 NULL 表示未分类' AFTER user_id,
  ADD CONSTRAINT fk_user_dataset_folder
    FOREIGN KEY (folder_id) REFERENCES user_dataset_folders (id) ON DELETE SET NULL,
  ADD KEY idx_user_dataset_user_folder
    (user_id, folder_id, created_at DESC);
