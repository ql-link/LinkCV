ALTER TABLE global_company
    ADD COLUMN aliases JSON NOT NULL DEFAULT (JSON_ARRAY()) COMMENT '用于唯一精确匹配的公司别名；重名不自动关联',
    ADD COLUMN logo_source VARCHAR(16) NOT NULL DEFAULT 'unknown' COMMENT '默认图标来源：unknown/official/plugin/admin',
    ADD COLUMN lock_version BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '公司资料乐观锁版本',
    MODIFY COLUMN logo_url VARCHAR(2048) NULL COMMENT '公司图标 HTTPS 地址或公共托管图片路径',
    ADD CONSTRAINT ck_global_company_aliases_array CHECK (JSON_TYPE(aliases) = 'ARRAY'),
    ADD CONSTRAINT ck_global_company_logo_source CHECK (logo_source IN ('unknown', 'official', 'plugin', 'admin'));
