-- Down migration for 0020: restore NOT NULL on email/password_hash
-- 仅当不存在空凭据行（微信登录用户）时恢复 NOT NULL；
-- 存在微信用户时降级会失败，需先处理这些账号。
ALTER TABLE users
  MODIFY COLUMN email VARCHAR(254) NOT NULL
    COMMENT '规范化后的登录邮箱',
  MODIFY COLUMN password_hash VARCHAR(255) NOT NULL
    COMMENT '密码摘要，不保存明文';
