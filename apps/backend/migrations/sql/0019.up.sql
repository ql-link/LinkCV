-- Up migration for 0019: add user wechat binding
-- 微信小程序 openid 全局唯一；绑定后本周不提供解绑。
ALTER TABLE users
  ADD COLUMN wechat_openid VARCHAR(64) NULL
    COMMENT '微信小程序 openid，绑定后写入，全局唯一' AFTER last_login_at,
  ADD COLUMN wechat_bound_at DATETIME(6) NULL
    COMMENT '微信绑定时间（UTC）' AFTER wechat_openid,
  ADD UNIQUE KEY uk_users_wechat_openid (wechat_openid);
