-- Down migration for 0013: drop wechat login binding
-- Restores NOT NULL on email/password_hash only if no NULL rows exist;
-- any WeChat-only users with empty credentials block the downgrade.
ALTER TABLE users
  DROP INDEX uk_users_wechat_openid,
  DROP COLUMN wechat_openid;

ALTER TABLE users
  MODIFY COLUMN email VARCHAR(254) NOT NULL
    COMMENT '规范化后的登录邮箱',
  MODIFY COLUMN password_hash VARCHAR(255) NOT NULL
    COMMENT '密码摘要，不保存明文';
