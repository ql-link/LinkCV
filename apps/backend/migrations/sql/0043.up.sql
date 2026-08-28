-- Up migration for 0043: add user_profiles
CREATE TABLE user_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '画像自增主键',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '画像所有者用户 id',
  lock_version INT UNSIGNED NOT NULL COMMENT '乐观锁版本，写请求必须携带上次读取值',
  work_city VARCHAR(100) NULL COMMENT '期望工作地点',
  salary_min DECIMAL(12, 2) NULL COMMENT '期望薪资下限',
  salary_max DECIMAL(12, 2) NULL COMMENT '期望薪资上限',
  salary_currency CHAR(3) ASCII NULL COMMENT '期望薪资币种 ISO 4217',
  salary_period VARCHAR(16) NULL COMMENT '计薪周期：hour/day/month/year',
  employment_type VARCHAR(24) NULL COMMENT '期望工作性质：full_time/part_time/internship/contract/temporary',
  work_mode VARCHAR(16) NULL COMMENT '期望工作方式：onsite/hybrid/remote',
  target_positions JSON NOT NULL COMMENT '职位方向字符串数组',
  exclusions JSON NOT NULL COMMENT '排除条件字符串数组',
  target_companies JSON NOT NULL COMMENT '目标公司字符串数组',
  availability VARCHAR(16) NULL COMMENT '可到岗时间：immediately/one_week/two_weeks/one_month/custom',
  available_from DATE NULL COMMENT '自定义到岗日期，availability=custom 时填写',
  school VARCHAR(255) NULL COMMENT '学校名称',
  school_tier JSON NOT NULL COMMENT '学校层级字符串数组：project_985/project_211/double_first_class',
  major VARCHAR(100) NULL COMMENT '专业方向',
  education_level VARCHAR(24) NULL COMMENT '学历层次：high_school/junior_college/bachelor/master/doctor',
  years_experience INT UNSIGNED NULL COMMENT '工作年限（应届生填 0）',
  birth_date DATE NULL COMMENT '出生日期（UTC 日期）',
  languages JSON NOT NULL COMMENT '语言能力字符串数组',
  skills JSON NOT NULL COMMENT '技能字符串数组',
  certifications JSON NOT NULL COMMENT '证书字符串数组',
  honors JSON NOT NULL COMMENT '个人荣誉字符串数组',
  campus_experiences JSON NOT NULL COMMENT '校园经历字符串数组',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间（UTC）',
  CONSTRAINT pk_user_profiles PRIMARY KEY (id),
  CONSTRAINT uk_user_profiles_user_id UNIQUE (user_id),
  CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT ck_user_profiles_lock_version CHECK (lock_version >= 1),
  CONSTRAINT ck_user_profiles_employment_type
    CHECK (employment_type IS NULL OR employment_type IN ('full_time', 'part_time', 'internship', 'contract', 'temporary')),
  CONSTRAINT ck_user_profiles_work_mode
    CHECK (work_mode IS NULL OR work_mode IN ('onsite', 'hybrid', 'remote')),
  CONSTRAINT ck_user_profiles_salary_period
    CHECK (salary_period IS NULL OR salary_period IN ('hour', 'day', 'month', 'year')),
  CONSTRAINT ck_user_profiles_salary_range
    CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min),
  CONSTRAINT ck_user_profiles_salary_context
    CHECK ((salary_min IS NULL AND salary_max IS NULL) OR (salary_currency IS NOT NULL AND salary_period IS NOT NULL)),
  CONSTRAINT ck_user_profiles_salary_currency
    CHECK (salary_currency IS NULL OR LENGTH(salary_currency) = 3),
  CONSTRAINT ck_user_profiles_availability
    CHECK (availability IS NULL OR availability IN ('immediately', 'one_week', 'two_weeks', 'one_month', 'custom')),
  CONSTRAINT ck_user_profiles_available_from_context
    CHECK (available_from IS NULL OR availability = 'custom'),
  CONSTRAINT ck_user_profiles_education_level
    CHECK (education_level IS NULL OR education_level IN ('high_school', 'junior_college', 'bachelor', 'master', 'doctor')),
  CONSTRAINT ck_user_profiles_years_experience
    CHECK (years_experience IS NULL OR years_experience >= 0),
  CONSTRAINT ck_user_profiles_target_positions_array
    CHECK (LOWER(JSON_TYPE(target_positions)) = 'array'),
  CONSTRAINT ck_user_profiles_exclusions_array
    CHECK (LOWER(JSON_TYPE(exclusions)) = 'array'),
  CONSTRAINT ck_user_profiles_target_companies_array
    CHECK (LOWER(JSON_TYPE(target_companies)) = 'array'),
  CONSTRAINT ck_user_profiles_languages_array
    CHECK (LOWER(JSON_TYPE(languages)) = 'array'),
  CONSTRAINT ck_user_profiles_skills_array
    CHECK (LOWER(JSON_TYPE(skills)) = 'array'),
  CONSTRAINT ck_user_profiles_certifications_array
    CHECK (LOWER(JSON_TYPE(certifications)) = 'array'),
  CONSTRAINT ck_user_profiles_honors_array
    CHECK (LOWER(JSON_TYPE(honors)) = 'array'),
  CONSTRAINT ck_user_profiles_campus_experiences_array
    CHECK (LOWER(JSON_TYPE(campus_experiences)) = 'array'),
  CONSTRAINT ck_user_profiles_school_tier_array
    CHECK (LOWER(JSON_TYPE(school_tier)) = 'array'),
  KEY idx_user_profiles_user_updated (user_id, updated_at DESC, id DESC)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='用户个人画像';
