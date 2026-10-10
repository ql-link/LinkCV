-- 0122: 公司图标统一站内存储、默认图指纹审核与待匹配名称；增量结构，插件外链默认图清空后由插件上传补回。
-- 已有站内图标的指纹由部署后脚本 scripts/release/migrate_company_logos.py 回填。

ALTER TABLE global_company
    ADD COLUMN logo_dhash CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '当前站内公司图标的 64 位差值哈希，用于识别默认图；为空表示无图、旧外链或待回填';

UPDATE global_company
SET logo_url = NULL, logo_source = 'unknown', lock_version = lock_version + 1
WHERE logo_source = 'plugin' AND logo_url LIKE 'https://%';

CREATE TABLE global_company_logo_fingerprint (
	id BIGINT UNSIGNED NOT NULL COMMENT '主键' AUTO_INCREMENT,
	dhash CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '规范化图片 64 位差值哈希的十六进制',
	sample_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '首个样图的规范化 WebP SHA-256，疑似后发布到公共命名空间供审核',
	company_names JSON NOT NULL COMMENT '使用该图的不同规范化公司名，最多保存 20 个' DEFAULT (JSON_ARRAY()),
	company_count INT UNSIGNED NOT NULL COMMENT '使用该图的不同公司名数量，即 company_names 的长度' DEFAULT '0',
	review_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '审核状态：normal/suspected/placeholder/allowed' DEFAULT 'normal',
	create_time DATETIME(6) NOT NULL COMMENT '创建时间' DEFAULT CURRENT_TIMESTAMP(6),
	update_time DATETIME(6) NOT NULL COMMENT '更新时间' DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
	CONSTRAINT pk_global_company_logo_fingerprint PRIMARY KEY (id),
	CONSTRAINT uk_global_company_logo_fingerprint_dhash UNIQUE (dhash),
	CONSTRAINT ck_global_company_logo_fingerprint_review_status CHECK (review_status IN ('normal','suspected','placeholder','allowed')),
	CONSTRAINT ck_global_company_logo_fingerprint_names CHECK (lower(json_type(company_names)) = 'array')
)ENGINE=InnoDB COMMENT='插件公司图标图像指纹分组与默认图审核状态' CHARSET=utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE INDEX idx_global_company_logo_fingerprint_status ON global_company_logo_fingerprint (review_status, company_count);

CREATE TABLE global_company_unmatched_name (
	id BIGINT UNSIGNED NOT NULL COMMENT '主键' AUTO_INCREMENT,
	normalized_name VARCHAR(200) NOT NULL COMMENT '规范化公司名',
	display_name VARCHAR(200) NOT NULL COMMENT '最近一次出现时的原始公司名，用于展示和写入别名',
	hit_count INT UNSIGNED NOT NULL COMMENT '出现次数' DEFAULT '1',
	is_ignored TINYINT UNSIGNED NOT NULL COMMENT '是否已被管理员忽略：1是0否' DEFAULT '0',
	last_seen_time DATETIME(6) NOT NULL COMMENT '最近出现时间',
	create_time DATETIME(6) NOT NULL COMMENT '创建时间' DEFAULT CURRENT_TIMESTAMP(6),
	update_time DATETIME(6) NOT NULL COMMENT '更新时间' DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
	CONSTRAINT pk_global_company_unmatched_name PRIMARY KEY (id),
	CONSTRAINT uk_global_company_unmatched_name_normalized_name UNIQUE (normalized_name),
	CONSTRAINT ck_global_company_unmatched_name_ignored CHECK (is_ignored IN (0,1))
)ENGINE=InnoDB COMMENT='插件图标上传时未能匹配任何公司的名称' CHARSET=utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE INDEX idx_global_company_unmatched_name_ignored_hits ON global_company_unmatched_name (is_ignored, hit_count);
