-- Up migration for 0013: add resume share link fields
-- 每份简历一个分享链接；share_token 为空表示未开启分享。
ALTER TABLE resumes
  ADD COLUMN share_token VARCHAR(64) NULL
    COMMENT '分享链接 token，全局唯一，NULL 表示未分享' AFTER updated_at,
  ADD COLUMN share_visibility VARCHAR(16) NULL
    COMMENT '分享可见性：private 仅自己可见 / public 所有人可见'
    AFTER share_token,
  ADD COLUMN share_expires_at DATETIME(6) NULL
    COMMENT '分享过期时间（UTC），NULL 表示长期有效' AFTER share_visibility,
  ADD COLUMN share_created_at DATETIME(6) NULL
    COMMENT '分享创建时间（UTC）' AFTER share_expires_at,
  ADD UNIQUE KEY uk_resumes_share_token (share_token),
  ADD CONSTRAINT ck_resumes_share_visibility
    CHECK (share_visibility IS NULL OR share_visibility IN ('private', 'public')),
  ADD CONSTRAINT ck_resumes_share_fields CHECK (
    (share_token IS NULL AND share_visibility IS NULL AND share_created_at IS NULL)
    OR (share_token IS NOT NULL AND share_visibility IS NOT NULL AND share_created_at IS NOT NULL)
  );
