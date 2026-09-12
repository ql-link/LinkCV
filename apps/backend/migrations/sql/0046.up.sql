-- Up migration for 0046: simplify user profile preferences.
-- The temporary table gives JSON_ARRAYAGG a deterministic order through its
-- window frame while retaining only the first occurrence of each accepted
-- employment type. Unsupported values are intentionally discarded.
CREATE TEMPORARY TABLE user_profile_employment_types_0046 (
  profile_id BIGINT UNSIGNED NOT NULL,
  employment_types JSON NOT NULL,
  PRIMARY KEY (profile_id)
) ENGINE=InnoDB;

INSERT INTO user_profile_employment_types_0046 (profile_id, employment_types)
SELECT profile_id, normalized_employment_types
FROM (
  SELECT
    profile_id,
    JSON_ARRAYAGG(employment_type_value) OVER (
      PARTITION BY profile_id
      ORDER BY first_position
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS normalized_employment_types,
    ROW_NUMBER() OVER (
      PARTITION BY profile_id
      ORDER BY first_position DESC
    ) AS row_number_in_profile
  FROM (
    SELECT
      profiles.id AS profile_id,
      parsed.employment_type_value,
      MIN(parsed.element_position) AS first_position
    FROM user_profiles AS profiles
    CROSS JOIN JSON_TABLE(
      profiles.employment_types,
      '$[*]' COLUMNS (
        element_position FOR ORDINALITY,
        employment_type_value VARCHAR(24) PATH '$'
      )
    ) AS parsed
    WHERE parsed.employment_type_value IN ('internship', 'full_time')
    GROUP BY profiles.id, parsed.employment_type_value
  ) AS deduplicated
) AS ordered
WHERE row_number_in_profile = 1;

INSERT IGNORE INTO user_profile_employment_types_0046 (
  profile_id,
  employment_types
)
SELECT id, JSON_ARRAY()
FROM user_profiles;

UPDATE user_profiles AS profiles
JOIN user_profile_employment_types_0046 AS normalized
  ON normalized.profile_id = profiles.id
SET profiles.employment_types = normalized.employment_types;

ALTER TABLE user_profiles
  MODIFY COLUMN employment_types JSON NOT NULL
    COMMENT '可接受工作性质数组：internship/full_time',
  DROP CHECK ck_user_profiles_professional_directions_array,
  DROP COLUMN professional_directions;

DROP TEMPORARY TABLE user_profile_employment_types_0046;
