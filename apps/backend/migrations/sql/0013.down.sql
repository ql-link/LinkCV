-- Down migration for 0013: drop resume share link fields
-- 分享字段全部可空且无存量数据，删除即可安全回退。
ALTER TABLE resumes
  DROP CHECK ck_resumes_share_fields,
  DROP CHECK ck_resumes_share_visibility,
  DROP INDEX uk_resumes_share_token,
  DROP COLUMN share_created_at,
  DROP COLUMN share_expires_at,
  DROP COLUMN share_visibility,
  DROP COLUMN share_token;
