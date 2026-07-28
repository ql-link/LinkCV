-- 0007 升级迁移：新增用户私有 JD 单表。
CREATE TABLE job_descriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'JD 自增主键',
  user_id BIGINT UNSIGNED NOT NULL COMMENT 'JD 所有者',
  job_title VARCHAR(200) NOT NULL COMMENT '岗位名称',
  company_name VARCHAR(200) NOT NULL COMMENT '公司展示名称',
  employment_type VARCHAR(24) NULL COMMENT '岗位类型',
  description LONGTEXT NOT NULL COMMENT '最终结构化 Markdown JD 正文',
  skills JSON NOT NULL COMMENT '去空去重后的技能字符串数组',
  education_requirement VARCHAR(100) NULL COMMENT '学历要求',
  experience_requirement VARCHAR(100) NULL COMMENT '经验或在校要求',
  work_schedule VARCHAR(100) NULL COMMENT '工作或实习安排',
  work_city VARCHAR(100) NULL COMMENT '工作城市或地区',
  work_address VARCHAR(500) NULL COMMENT '详细工作地址',
  work_mode VARCHAR(16) NULL COMMENT '工作方式',
  salary_text VARCHAR(128) NULL COMMENT '薪资展示原文',
  salary_min DECIMAL(12, 2) NULL COMMENT '薪资区间下限',
  salary_max DECIMAL(12, 2) NULL COMMENT '薪资区间上限',
  salary_currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT 'ISO 4217 币种',
  salary_period VARCHAR(16) NULL COMMENT '计薪周期',
  salary_months_per_year SMALLINT UNSIGNED NULL COMMENT '年薪折算月数',
  company_legal_name VARCHAR(255) NULL COMMENT '公司工商全称快照',
  company_industry VARCHAR(100) NULL COMMENT '行业快照',
  company_size VARCHAR(50) NULL COMMENT '公司规模快照',
  company_financing_stage VARCHAR(50) NULL COMMENT '融资阶段快照',
  company_description LONGTEXT NULL COMMENT '公司简介快照',
  recruiter_name VARCHAR(100) NULL COMMENT '招聘者展示姓名',
  recruiter_title VARCHAR(100) NULL COMMENT '招聘者职位',
  source_type VARCHAR(24) NOT NULL COMMENT '来源类型：manual 或 external_import',
  source_site VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT '来源适配器标识',
  source_job_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT '来源站点原生岗位标识',
  source_url VARCHAR(2048) NULL COMMENT '后端规范化来源链接',
  source_url_hash BINARY(32) NULL COMMENT '规范化来源链接 SHA-256',
  imported_at DATETIME(6) NULL COMMENT '外部结构化数据写入时间（UTC）',
  notes TEXT NULL COMMENT '用户个人备注',
  archived_at DATETIME(6) NULL COMMENT '归档时间（UTC）',
  lock_version INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    COMMENT '创建时间（UTC）',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间（UTC）',
  CONSTRAINT pk_job_descriptions PRIMARY KEY (id),
  CONSTRAINT fk_job_descriptions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT uk_job_descriptions_user_source_job
    UNIQUE (user_id, source_site, source_job_id),
  CONSTRAINT uk_job_descriptions_user_source_url
    UNIQUE (user_id, source_url_hash),
  KEY idx_job_descriptions_user_archive_updated_id
    (user_id, archived_at, updated_at DESC, id DESC),
  KEY idx_job_descriptions_user_updated_id
    (user_id, updated_at DESC, id DESC),
  CONSTRAINT ck_job_descriptions_job_title_not_blank
    CHECK (LENGTH(TRIM(job_title)) > 0),
  CONSTRAINT ck_job_descriptions_company_name_not_blank
    CHECK (LENGTH(TRIM(company_name)) > 0),
  CONSTRAINT ck_job_descriptions_description_not_blank
    CHECK (LENGTH(TRIM(description)) > 0),
  CONSTRAINT ck_job_descriptions_skills_array
    CHECK (JSON_TYPE(skills) = 'ARRAY'),
  CONSTRAINT ck_job_descriptions_employment_type
    CHECK (employment_type IS NULL OR employment_type IN
      ('full_time', 'part_time', 'internship', 'contract', 'temporary')),
  CONSTRAINT ck_job_descriptions_work_mode
    CHECK (work_mode IS NULL OR work_mode IN ('onsite', 'hybrid', 'remote')),
  CONSTRAINT ck_job_descriptions_salary_period
    CHECK (salary_period IS NULL OR salary_period IN ('hour', 'day', 'month', 'year')),
  CONSTRAINT ck_job_descriptions_salary_min
    CHECK (salary_min IS NULL OR salary_min >= 0),
  CONSTRAINT ck_job_descriptions_salary_max
    CHECK (salary_max IS NULL OR salary_max >= 0),
  CONSTRAINT ck_job_descriptions_salary_range
    CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min),
  CONSTRAINT ck_job_descriptions_salary_context
    CHECK ((salary_min IS NULL AND salary_max IS NULL) OR
      (salary_currency IS NOT NULL AND salary_period IS NOT NULL)),
  CONSTRAINT ck_job_descriptions_salary_currency
    CHECK (salary_currency IS NULL OR LENGTH(salary_currency) = 3),
  CONSTRAINT ck_job_descriptions_salary_months
    CHECK (salary_months_per_year IS NULL OR salary_months_per_year >= 1),
  CONSTRAINT ck_job_descriptions_source_type
    CHECK (source_type IN ('manual', 'external_import')),
  CONSTRAINT ck_job_descriptions_source_fields CHECK (
    (((source_url IS NULL) AND (source_url_hash IS NULL)
      AND (source_site IS NULL) AND (source_job_id IS NULL)) OR
     ((source_url IS NOT NULL) AND (source_url_hash IS NOT NULL)
      AND (source_site IS NOT NULL)))
    AND ((source_job_id IS NULL) OR (source_site IS NOT NULL))
    AND ((source_type = 'external_import' AND source_url IS NOT NULL
      AND source_site IS NOT NULL AND source_url_hash IS NOT NULL
      AND imported_at IS NOT NULL)
      OR (source_type = 'manual' AND imported_at IS NULL))
  ),
  CONSTRAINT ck_job_descriptions_lock_version CHECK (lock_version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='用户保存的结构化岗位描述';
