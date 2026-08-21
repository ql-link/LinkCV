-- Up migration for 0002: create four core tables
-- The revision preflight verifies all existing business tables are empty.
-- IF EXISTS makes the empty-schema migration retryable after partial MySQL DDL.
DROP TABLE IF EXISTS resume_versions;
DROP TABLE IF EXISTS resumes;
DROP TABLE IF EXISTS resume_templates;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户自增主键',
  email VARCHAR(254) NOT NULL COMMENT '规范化后的登录邮箱',
  password_hash VARCHAR(255) NOT NULL COMMENT '密码摘要，不保存明文',
  nickname VARCHAR(50) NOT NULL COMMENT '用户展示昵称',
  avatar_object_key VARCHAR(512) NULL DEFAULT NULL COMMENT '私有头像对象键',
  status TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '账号状态：0 禁用，1 启用',
  is_admin TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '管理员标记：0 否，1 是',
  last_login_at DATETIME(6) NULL DEFAULT NULL COMMENT '最近一次成功登录时间（UTC）',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间（UTC）',
  CONSTRAINT pk_users PRIMARY KEY (id),
  CONSTRAINT uk_users_email UNIQUE (email),
  CONSTRAINT ck_users_status CHECK (status IN (0, 1)),
  CONSTRAINT ck_users_is_admin CHECK (is_admin IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='用户账号';

CREATE TABLE resume_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '模板自增主键',
  `key` VARCHAR(64) NOT NULL COMMENT '规范化稳定标识',
  name VARCHAR(128) NOT NULL COMMENT '模板展示名称',
  description TEXT NULL DEFAULT NULL COMMENT '模板说明',
  data_json JSON NOT NULL COMMENT 'ResumeDocumentV1 初始内容',
  style_json JSON NOT NULL COMMENT 'ResumeStyleV1 默认样式',
  is_active TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '模板状态：0 停用，1 启用',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间（UTC）',
  CONSTRAINT pk_resume_templates PRIMARY KEY (id),
  CONSTRAINT uk_resume_templates_key UNIQUE (`key`),
  CONSTRAINT ck_resume_templates_is_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='简历模板';

CREATE TABLE resumes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '简历自增主键',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '简历所有者',
  template_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '创建来源模板',
  title VARCHAR(255) NOT NULL COMMENT '简历标题',
  data_json JSON NOT NULL COMMENT '当前 ResumeDocumentV1 内容',
  style_json JSON NOT NULL COMMENT '当前 ResumeStyleV1 样式',
  lock_version INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本',
  source_type VARCHAR(16) NOT NULL DEFAULT 'blank'
    COMMENT '来源类型：blank、template 或 import',
  source_filename VARCHAR(255) NULL DEFAULT NULL COMMENT '导入文件原名',
  source_object_key VARCHAR(512) NULL DEFAULT NULL COMMENT '私有导入原文件对象键',
  extracted_markdown LONGTEXT NULL DEFAULT NULL COMMENT '导入解析的中间文本证据',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间（UTC）',
  CONSTRAINT pk_resumes PRIMARY KEY (id),
  CONSTRAINT fk_resumes_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_resumes_template FOREIGN KEY (template_id)
    REFERENCES resume_templates (id) ON DELETE RESTRICT,
  CONSTRAINT ck_resumes_source_type
    CHECK (source_type IN ('blank', 'template', 'import')),
  CONSTRAINT ck_resumes_title_not_blank
    CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  CONSTRAINT ck_resumes_lock_version CHECK (lock_version >= 1),
  CONSTRAINT ck_resumes_source_fields CHECK (
    (source_type = 'blank'
      AND template_id IS NULL
      AND source_filename IS NULL
      AND source_object_key IS NULL
      AND extracted_markdown IS NULL)
    OR
    (source_type = 'template'
      AND template_id IS NOT NULL
      AND source_filename IS NULL
      AND source_object_key IS NULL
      AND extracted_markdown IS NULL)
    OR
    (source_type = 'import'
      AND template_id IS NULL
      AND source_filename IS NOT NULL
      AND source_object_key IS NOT NULL
      AND extracted_markdown IS NOT NULL)
  ),
  KEY idx_resumes_user_updated_id (user_id, updated_at DESC, id DESC),
  KEY idx_resumes_template_id (template_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='用户简历当前版本';

CREATE TABLE resume_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '版本快照自增主键',
  resume_id BIGINT UNSIGNED NOT NULL COMMENT '所属简历',
  version_no INT UNSIGNED NOT NULL COMMENT '简历内单调递增版本号',
  data_json JSON NOT NULL COMMENT 'ResumeDocumentV1 内容快照',
  style_json JSON NOT NULL COMMENT 'ResumeStyleV1 样式快照',
  reason VARCHAR(32) NOT NULL
    COMMENT '创建原因：initial、manual、before_restore 或 restore',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '快照创建时间（UTC）',
  CONSTRAINT pk_resume_versions PRIMARY KEY (id),
  CONSTRAINT fk_resume_versions_resume FOREIGN KEY (resume_id)
    REFERENCES resumes (id) ON DELETE CASCADE,
  CONSTRAINT uk_resume_versions_no UNIQUE (resume_id, version_no),
  CONSTRAINT ck_resume_versions_no CHECK (version_no >= 1),
  CONSTRAINT ck_resume_versions_reason
    CHECK (reason IN ('initial', 'manual', 'before_restore', 'restore'))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='不可变简历历史快照';
