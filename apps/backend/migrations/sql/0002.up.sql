-- Up migration for 0002: rebuild users and resumes to the target schema
-- users 改为 BIGINT 自增聚簇主键,去掉 auth_version,按设计稿补齐昵称/头像/状态/管理员/最近登录.
-- resumes.user_id 改为 BIGINT UNSIGNED 外键,外键删除策略改为 RESTRICT,与设计稿一致.
-- 原型 SQLite/UUID 数据不迁移,因此采用 drop + recreate 的破坏性重建方式.

DROP TABLE resumes;
DROP TABLE users;

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  nickname VARCHAR(50) NOT NULL,
  avatar_object_key VARCHAR(512) NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  is_admin TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_login_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT uk_users_email UNIQUE (email),
  CONSTRAINT ck_users_status CHECK (status IN (0, 1)),
  CONSTRAINT ck_users_is_admin CHECK (is_admin IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE resumes (
  id VARCHAR(39) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  markdown LONGTEXT NOT NULL,
  settings JSON NOT NULL,
  split_ratio DOUBLE NOT NULL DEFAULT 0.4,
  preview_scale DOUBLE NOT NULL DEFAULT 1.0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_resumes_user_updated (user_id, updated_at),
  CONSTRAINT fk_resumes_user_id_users
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT ck_resumes_split_ratio_positive CHECK (split_ratio > 0),
  CONSTRAINT ck_resumes_preview_scale_positive CHECK (preview_scale > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
