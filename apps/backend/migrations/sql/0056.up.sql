-- Current document metadata and transient replacement/cleanup records.
ALTER TABLE user_dataset
 ADD COLUMN content_revision BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '正文并发序号',
 ADD COLUMN content_object_name VARCHAR(512) NULL COMMENT '当前正文对象',
 ADD COLUMN content_sha256 CHAR(64) NULL COMMENT '当前正文摘要',
 ADD COLUMN content_updated_at DATETIME(6) NULL COMMENT '正文更新时间 UTC',
 ADD COLUMN last_content_request_id VARCHAR(64) NULL COMMENT '最近保存请求';

CREATE TABLE dataset_replacements (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, 
	user_id BIGINT UNSIGNED NOT NULL, 
	dataset_id BIGINT UNSIGNED NOT NULL, 
	parse_task_id BIGINT UNSIGNED, 
	source_content_type VARCHAR(128) NOT NULL, 
	source_file_size BIGINT UNSIGNED NOT NULL, 
	source_sha256 CHAR(64) NOT NULL, 
	idempotency_key VARCHAR(64) NOT NULL, 
	request_fingerprint CHAR(64) NOT NULL, 
	base_revision BIGINT UNSIGNED NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	active_dataset_id BIGINT UNSIGNED, 
	last_retry_request_id VARCHAR(64), 
	failure_code VARCHAR(64), 
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), 
	updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), 
	CONSTRAINT pk_dataset_replacements PRIMARY KEY (id), 
	CONSTRAINT uk_dataset_replacements_user_request UNIQUE (user_id, idempotency_key), 
	CONSTRAINT uk_dataset_replacements_active UNIQUE (active_dataset_id), 
	CONSTRAINT uk_dataset_replacements_task UNIQUE (parse_task_id), 
	CONSTRAINT ck_dataset_replacements_status CHECK (status IN ('pending','failed','conflict','applied','discarded')), 
	CONSTRAINT ck_dataset_replacements_active CHECK ((status IN ('pending','failed','conflict') AND active_dataset_id IS NOT NULL AND active_dataset_id = dataset_id) OR (status IN ('applied','discarded') AND active_dataset_id IS NULL)), 
	CONSTRAINT fk_dataset_replacements_user FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT, 
	CONSTRAINT fk_dataset_replacements_dataset FOREIGN KEY(dataset_id) REFERENCES user_dataset (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX idx_dataset_replacements_cleanup ON dataset_replacements (status, updated_at);
CREATE INDEX idx_dataset_replacements_target ON dataset_replacements (dataset_id, created_at);

CREATE TABLE dataset_object_cleanup (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, 
	user_id BIGINT UNSIGNED NOT NULL, 
	object_name VARCHAR(512) NOT NULL, 
	parse_task_id BIGINT UNSIGNED, 
	not_before DATETIME(6) NOT NULL, 
	attempt_count INTEGER UNSIGNED NOT NULL DEFAULT '0', 
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), 
	CONSTRAINT pk_dataset_object_cleanup PRIMARY KEY (id), 
	CONSTRAINT uk_dataset_object_cleanup_object UNIQUE (object_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX idx_dataset_object_cleanup_due ON dataset_object_cleanup (not_before, id);
