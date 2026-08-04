-- Down migration for 0011: drop legacy resume backups
-- Lossy schema-only rollback: deleted legacy JSON values remain unavailable.
-- Recovering those values requires restoring an external database backup.
ALTER TABLE resumes
  ADD COLUMN legacy_data_json_backup JSON NULL
    COMMENT '0005 迁移前的旧版内容 JSON；0011 降级仅恢复空列' AFTER style_json,
  ADD COLUMN legacy_style_json_backup JSON NULL
    COMMENT '0005 迁移前的旧版样式 JSON；0011 降级仅恢复空列'
    AFTER legacy_data_json_backup;

ALTER TABLE resume_versions
  ADD COLUMN legacy_data_json_backup JSON NULL
    COMMENT '0005 迁移前的旧版内容 JSON；0011 降级仅恢复空列' AFTER style_json,
  ADD COLUMN legacy_style_json_backup JSON NULL
    COMMENT '0005 迁移前的旧版样式 JSON；0011 降级仅恢复空列'
    AFTER legacy_data_json_backup;
