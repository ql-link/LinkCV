-- Up migration for 0023: add resume version names.

ALTER TABLE resume_versions
  ADD COLUMN name VARCHAR(80) NULL
    COMMENT '正式版本名称' AFTER reason;

UPDATE resume_versions
SET name = CASE reason
  WHEN 'initial' THEN '初始版本'
  WHEN 'before_restore' THEN '恢复前备份'
  WHEN 'restore' THEN '恢复结果（历史记录）'
  ELSE CONCAT('版本 ', version_no)
END
WHERE name IS NULL OR TRIM(name) = '';

ALTER TABLE resume_versions
  MODIFY COLUMN name VARCHAR(80) NOT NULL
    COMMENT '正式版本名称';
