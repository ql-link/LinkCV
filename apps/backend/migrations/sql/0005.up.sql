-- Up migration for 0005: migrate legacy resume snapshots
ALTER TABLE resumes
  ADD COLUMN legacy_data_json_backup JSON NULL
    COMMENT '0005 迁移前的旧版内容 JSON；仅旧记录有值' AFTER style_json,
  ADD COLUMN legacy_style_json_backup JSON NULL
    COMMENT '0005 迁移前的旧版样式 JSON；仅旧记录有值' AFTER legacy_data_json_backup;

ALTER TABLE resume_versions
  ADD COLUMN legacy_data_json_backup JSON NULL
    COMMENT '0005 迁移前的旧版内容 JSON；仅旧记录有值' AFTER style_json,
  ADD COLUMN legacy_style_json_backup JSON NULL
    COMMENT '0005 迁移前的旧版样式 JSON；仅旧记录有值' AFTER legacy_data_json_backup;
