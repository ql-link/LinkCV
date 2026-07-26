-- Down migration for 0002: create four core tables
-- The revision preflight verifies all existing business tables are empty.
-- Downgrade cannot losslessly convert numeric IDs and JSON data to 0001.
DROP TABLE IF EXISTS resume_versions;
DROP TABLE IF EXISTS resumes;
DROP TABLE IF EXISTS resume_templates;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id VARCHAR(37) NOT NULL,
  email VARCHAR(320) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  auth_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT uk_users_email UNIQUE (email),
  CONSTRAINT ck_users_auth_version_positive CHECK (auth_version > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE resumes (
  id VARCHAR(39) NOT NULL,
  user_id VARCHAR(37) NOT NULL,
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
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_resumes_split_ratio_positive CHECK (split_ratio > 0),
  CONSTRAINT ck_resumes_preview_scale_positive CHECK (preview_scale > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
