-- Up migration for 0001: create users and resumes
-- Compatible with the deployed MySQL 8.0 baseline and the MySQL 8.4 target.
CREATE TABLE users (
  id VARCHAR(37) NOT NULL,
  email VARCHAR(320) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  auth_version INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uk_users_email UNIQUE (email)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE resumes (
  id VARCHAR(39) NOT NULL,
  user_id VARCHAR(37) NOT NULL,
  title VARCHAR(255) NOT NULL,
  markdown TEXT NOT NULL,
  settings JSON NOT NULL,
  split_ratio FLOAT NOT NULL DEFAULT 0.4,
  preview_scale FLOAT NOT NULL DEFAULT 1.0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_resumes_user_updated (user_id, updated_at),
  CONSTRAINT fk_resumes_user_id_users
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
