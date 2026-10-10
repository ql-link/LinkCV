-- 0118: official job pool; additive, forward-only, no external requests.

CREATE TABLE global_job_source (
	id BIGINT UNSIGNED NOT NULL COMMENT '来源主键' AUTO_INCREMENT,
	company_id BIGINT UNSIGNED NOT NULL COMMENT '已有企业引用',
	adapter_key VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '白名单适配器',
	tenant_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '适配器租户身份',
	portal_config JSON NOT NULL COMMENT '版本化门户配置',
	is_enabled TINYINT UNSIGNED NOT NULL COMMENT '是否启用：1是0否' DEFAULT '0',
	sync_generation BIGINT UNSIGNED NOT NULL COMMENT '配置或任务变更递增的写入版本' DEFAULT '0',
	sync_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '最近同步状态' DEFAULT 'idle',
	lease_until DATETIME(6) COMMENT '当前任务租约过期时间',
	next_sync_at DATETIME(6) COMMENT '下次同步时间',
	last_complete_at DATETIME(6) COMMENT '最近完整有效同步时间',
	last_sync_result JSON COMMENT '最新同步摘要与有效数量基线',
	create_time DATETIME(6) NOT NULL COMMENT '创建时间' DEFAULT CURRENT_TIMESTAMP(6),
	update_time DATETIME(6) NOT NULL COMMENT '更新时间' DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT pk_global_job_source PRIMARY KEY (id),
	CONSTRAINT uk_global_job_source_adapter_tenant UNIQUE (adapter_key, tenant_key),
	CONSTRAINT ck_global_job_source_enabled CHECK (is_enabled IN (0,1)),
	CONSTRAINT ck_global_job_source_status CHECK (sync_status IN ('idle','queued','running','succeeded','partial','failed','anomalous','cancelled')),
	CONSTRAINT ck_global_job_source_config CHECK (lower(json_type(portal_config)) = 'object')
)ENGINE=InnoDB COMMENT='企业官方招聘采集来源与最近同步状态' CHARSET=utf8mb4 COLLATE utf8mb4_0900_ai_ci

;

CREATE TABLE global_job (
	id BIGINT UNSIGNED NOT NULL COMMENT '公共岗位主键' AUTO_INCREMENT,
	source_id BIGINT UNSIGNED NOT NULL COMMENT '采集来源引用',
	source_job_key VARCHAR(192) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '原生编号或规范链接哈希身份',
	job_title VARCHAR(200) NOT NULL COMMENT '岗位标题',
	job_category VARCHAR(100) COMMENT '标准岗位类别',
	recruitment_channel VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'campus/experienced/unknown' DEFAULT 'unknown',
	employment_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'internship/full_time/part_time/contract/unknown' DEFAULT 'unknown',
	salary_text VARCHAR(128) COMMENT '薪资原文',
	locations JSON NOT NULL COMMENT '标准城市数组与来源地点原文',
	description LONGTEXT NOT NULL COMMENT '完整安全岗位正文',
	source_attributes JSON NOT NULL COMMENT '白名单来源补充属性',
	published_at DATETIME(6) COMMENT '来源明确的发布时间',
	source_url VARCHAR(2048) NOT NULL COMMENT '官方详情与投递入口',
	availability_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'active/missing/closed' DEFAULT 'active',
	last_seen_at DATETIME(6) NOT NULL COMMENT '最近有效观察时间',
	last_seen_generation BIGINT UNSIGNED NOT NULL COMMENT '该来源最近观察代次',
	missing_count INTEGER UNSIGNED NOT NULL COMMENT '连续完整同步缺失次数' DEFAULT '0',
	missing_since DATETIME(6) COMMENT '本次连续缺失起点',
	create_time DATETIME(6) NOT NULL COMMENT '创建与首次发现时间' DEFAULT CURRENT_TIMESTAMP(6),
	update_time DATETIME(6) NOT NULL COMMENT '更新时间' DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT pk_global_job PRIMARY KEY (id),
	CONSTRAINT uk_global_job_source_key UNIQUE (source_id, source_job_key),
	CONSTRAINT ck_global_job_status CHECK (availability_status IN ('active','missing','closed')),
	CONSTRAINT ck_global_job_channel CHECK (recruitment_channel IN ('campus','experienced','unknown')),
	CONSTRAINT ck_global_job_employment CHECK (employment_type IN ('internship','full_time','part_time','contract','unknown')),
	CONSTRAINT ck_global_job_text CHECK (length(trim(job_title)) > 0 AND length(trim(description)) > 0),
	CONSTRAINT ck_global_job_locations CHECK (JSON_TYPE(locations) = 'OBJECT' AND JSON_TYPE(JSON_EXTRACT(locations, '$.cities')) = 'ARRAY'),
	CONSTRAINT ck_global_job_attributes CHECK (lower(json_type(source_attributes)) = 'object'),
	CONSTRAINT ck_global_job_missing_count CHECK (missing_count >= 0)
)ENGINE=InnoDB COMMENT='平台共享官方招聘岗位' CHARSET=utf8mb4 COLLATE utf8mb4_0900_ai_ci

;
CREATE FULLTEXT INDEX idx_global_job_search ON global_job (job_title, description) WITH PARSER ngram;
CREATE INDEX idx_global_job_create_time ON global_job (create_time, id);

ALTER TABLE job_description ADD COLUMN global_job_id BIGINT UNSIGNED NULL COMMENT '公共岗位来源，存量及手工岗位为空', ADD CONSTRAINT uk_job_description_user_global_job UNIQUE (user_id, global_job_id);
