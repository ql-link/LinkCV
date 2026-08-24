-- 0036 升级迁移：新增版本更新通知与用户已读时间。

CREATE TABLE release_notices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '更新通知自增主键',
  title VARCHAR(128) NOT NULL COMMENT '通知标题',
  content TEXT NOT NULL COMMENT '通知正文（受限 Markdown）',
  published_at DATETIME(6) NOT NULL COMMENT '发布时间 UTC，用于排序与未读比较',
  revoked_at DATETIME(6) NULL COMMENT '下架时间 UTC；NULL 表示已发布',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间 UTC',
  CONSTRAINT pk_release_notices PRIMARY KEY (id),
  CONSTRAINT ck_release_notices_title_not_blank CHECK (LENGTH(TRIM(title)) > 0),
  CONSTRAINT ck_release_notices_content_not_blank CHECK (LENGTH(TRIM(content)) > 0)
) COMMENT '版本更新通知';

CREATE INDEX idx_release_notices_published ON release_notices (published_at, id);

ALTER TABLE users
  ADD COLUMN last_notice_read_at DATETIME(6) NULL COMMENT '用户最近一次打开更新通知弹窗的时间 UTC；NULL 表示从未读取' AFTER wechat_bound_at;
