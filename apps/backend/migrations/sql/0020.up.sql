-- Up migration for 0020: allow WeChat login users without credentials
-- 微信扫码登录用户没有邮箱和密码，email/password_hash 放宽为可空。
-- uk_users_email 依旧有效：MySQL 唯一索引允许多个 NULL 行。
ALTER TABLE users
  MODIFY COLUMN email VARCHAR(254) NULL DEFAULT NULL
    COMMENT '规范化后的登录邮箱（微信登录用户可为空）',
  MODIFY COLUMN password_hash VARCHAR(255) NULL DEFAULT NULL
    COMMENT '密码摘要，不保存明文（微信登录用户可为空）';
