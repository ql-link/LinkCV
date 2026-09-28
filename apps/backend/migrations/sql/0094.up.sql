-- Upgrade migration for 0094: add announcements
CREATE TABLE announcements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '公告主键',
  level VARCHAR(16) NOT NULL DEFAULT 'normal' COMMENT '级别：normal、important',
  title VARCHAR(120) NOT NULL COMMENT '标题，纯文本',
  body TEXT NOT NULL COMMENT '正文，纯文本与换行，应用层限制 5000 字',
  status VARCHAR(16) NOT NULL DEFAULT 'draft' COMMENT '状态：draft、published、unpublished',
  starts_at DATETIME(6) NULL COMMENT '生效开始 UTC；为空时以发布时间为准',
  ends_at DATETIME(6) NULL COMMENT '生效结束 UTC；为空表示不过期',
  published_at DATETIME(6) NULL COMMENT '发布时间 UTC',
  unpublished_at DATETIME(6) NULL COMMENT '下线时间 UTC',
  created_by BIGINT UNSIGNED NOT NULL COMMENT '创建管理员',
  updated_by BIGINT UNSIGNED NOT NULL COMMENT '最后编辑管理员',
  published_by BIGINT UNSIGNED NULL COMMENT '发布管理员',
  unpublished_by BIGINT UNSIGNED NULL COMMENT '下线管理员',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间 UTC',
  CONSTRAINT pk_announcements PRIMARY KEY (id),
  CONSTRAINT fk_announcements_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_announcements_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_announcements_published_by FOREIGN KEY (published_by)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_announcements_unpublished_by FOREIGN KEY (unpublished_by)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT ck_announcements_level CHECK (level IN ('normal', 'important')),
  CONSTRAINT ck_announcements_status CHECK (status IN ('draft', 'published', 'unpublished')),
  CONSTRAINT ck_announcements_window CHECK (
    ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at
  ),
  CONSTRAINT ck_announcements_state_fields CHECK (
    (status = 'draft' AND published_at IS NULL AND published_by IS NULL
      AND unpublished_at IS NULL AND unpublished_by IS NULL)
    OR (status = 'published' AND published_at IS NOT NULL AND published_by IS NOT NULL
      AND unpublished_at IS NULL AND unpublished_by IS NULL)
    OR (status = 'unpublished' AND published_at IS NOT NULL AND published_by IS NOT NULL
      AND unpublished_at IS NOT NULL AND unpublished_by IS NOT NULL)
  ),
  INDEX idx_announcements_status_published (status, published_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='全站应用内公告';

CREATE TABLE announcement_read_cursors (
  user_id BIGINT UNSIGNED NOT NULL COMMENT '用户',
  read_through_at DATETIME(6) NOT NULL COMMENT '已读到的时间点 UTC；此刻及之前开始展示的公告视为已读',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间 UTC',
  CONSTRAINT pk_announcement_read_cursors PRIMARY KEY (user_id),
  CONSTRAINT fk_announcement_read_cursors_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户公告已读时间点，每个用户至多一行';
