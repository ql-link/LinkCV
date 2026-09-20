-- Upgrade migration for 0064: add resume share download permission
ALTER TABLE resumes
  ADD COLUMN share_allow_download TINYINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '是否允许通过分享页下载 PDF：0 禁止 / 1 允许'
    AFTER share_expires_at,
  ADD CONSTRAINT ck_resumes_share_allow_download CHECK (
    share_allow_download IN (0, 1)
  );
