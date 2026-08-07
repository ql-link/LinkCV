-- Up migration for 0013: add wechat login binding to users
-- WeChat login users have no email or password, so both columns become nullable.
-- uk_users_email remains valid: MySQL unique indexes allow multiple NULL rows.
ALTER TABLE users
  ADD COLUMN wechat_openid VARCHAR(64) NULL DEFAULT NULL
    COMMENT '微信 openid，登录绑定标识；一微信一账号' AFTER is_admin,
  ADD CONSTRAINT uk_users_wechat_openid UNIQUE (wechat_openid);

ALTER TABLE users
  MODIFY COLUMN email VARCHAR(254) NULL DEFAULT NULL
    COMMENT '规范化后的登录邮箱（微信登录用户可为空）',
  MODIFY COLUMN password_hash VARCHAR(255) NULL DEFAULT NULL
    COMMENT '密码摘要，不保存明文（微信登录用户可为空）';
