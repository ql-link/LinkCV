-- Down migration for 0019: drop user wechat binding
-- 绑定字段可空且为本周新增，无历史数据依赖，删除即可安全回退。
ALTER TABLE users
  DROP INDEX uk_users_wechat_openid,
  DROP COLUMN wechat_bound_at,
  DROP COLUMN wechat_openid;
