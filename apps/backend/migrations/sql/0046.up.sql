-- Up migration for 0046: restructure user profile fields.
-- The paired Python revision performs the strict 0044 schema/data preflight
-- and verifies the converted rows and final schema after these statements.
ALTER TABLE user_profiles
  ADD COLUMN candidate_cities JSON NULL COMMENT '可接受工作城市字符串数组',
  ADD COLUMN employment_types JSON NULL COMMENT '可接受工作性质数组：full_time/part_time/internship/contract/temporary',
  ADD COLUMN professional_directions JSON NULL COMMENT '职业方向字符串数组',
  ADD COLUMN candidate_status VARCHAR(24) NULL COMMENT '候选人类型：fresh_graduate/experienced',
  ADD COLUMN graduation_year SMALLINT UNSIGNED NULL COMMENT '应届生毕业年份，candidate_status=fresh_graduate 时必填';

UPDATE user_profiles
SET candidate_cities = CASE
      WHEN work_city IS NULL OR TRIM(work_city) = '' THEN JSON_ARRAY()
      ELSE JSON_ARRAY(TRIM(work_city))
    END,
    employment_types = CASE
      WHEN employment_type IS NULL OR TRIM(employment_type) = '' THEN JSON_ARRAY()
      ELSE JSON_ARRAY(TRIM(employment_type))
    END,
    professional_directions = COALESCE(target_positions, JSON_ARRAY()),
    candidate_status = NULL,
    graduation_year = NULL,
    updated_at = updated_at;

ALTER TABLE user_profiles
  MODIFY COLUMN candidate_cities JSON NOT NULL COMMENT '可接受工作城市字符串数组',
  MODIFY COLUMN employment_types JSON NOT NULL COMMENT '可接受工作性质数组：full_time/part_time/internship/contract/temporary',
  MODIFY COLUMN professional_directions JSON NOT NULL COMMENT '职业方向字符串数组';

ALTER TABLE user_profiles
  DROP CHECK ck_user_profiles_employment_type,
  DROP CHECK ck_user_profiles_work_mode,
  DROP CHECK ck_user_profiles_availability,
  DROP CHECK ck_user_profiles_available_from_context,
  DROP CHECK ck_user_profiles_target_positions_array,
  DROP CHECK ck_user_profiles_exclusions_array,
  DROP CHECK ck_user_profiles_target_companies_array,
  DROP COLUMN work_city,
  DROP COLUMN employment_type,
  DROP COLUMN work_mode,
  DROP COLUMN target_positions,
  DROP COLUMN exclusions,
  DROP COLUMN target_companies,
  DROP COLUMN availability,
  DROP COLUMN available_from,
  DROP COLUMN birth_date,
  ADD CONSTRAINT ck_user_profiles_candidate_cities_array
    CHECK (LOWER(JSON_TYPE(candidate_cities)) = 'array'),
  ADD CONSTRAINT ck_user_profiles_employment_types_array
    CHECK (LOWER(JSON_TYPE(employment_types)) = 'array'),
  ADD CONSTRAINT ck_user_profiles_professional_directions_array
    CHECK (LOWER(JSON_TYPE(professional_directions)) = 'array'),
  ADD CONSTRAINT ck_user_profiles_candidate_status
    CHECK (candidate_status IS NULL OR candidate_status IN ('fresh_graduate', 'experienced')),
  ADD CONSTRAINT ck_user_profiles_graduation_year
    CHECK (graduation_year IS NULL OR graduation_year BETWEEN 1900 AND 9999),
  ADD CONSTRAINT ck_user_profiles_candidate_experience_context
    CHECK (
      (candidate_status IS NULL AND graduation_year IS NULL)
      OR (candidate_status IS NOT NULL AND candidate_status = 'fresh_graduate'
          AND graduation_year IS NOT NULL AND years_experience IS NOT NULL
          AND years_experience = 0)
      OR (candidate_status IS NOT NULL AND candidate_status = 'experienced'
          AND graduation_year IS NULL)
    );
