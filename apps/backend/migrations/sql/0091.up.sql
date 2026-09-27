-- 0091: replace legacy LLM governance data with connection/model/route/use-case records.

-- Release gate: verify target revision, old row counts, no running Agent runs, and a database backup.

-- Old LLM rows are intentionally discarded as authorized; existing Agent sessions/runs are retained.

DROP TABLE llm_capability_bindings;

DROP TABLE llm_model_validations;

DROP TABLE llm_call_logs;

DROP TABLE llm_model_configs;

CREATE TABLE llm_provider_connections (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	provider_code VARCHAR(32) NOT NULL,
	name VARCHAR(128) NOT NULL,
	credential_ciphertext TEXT,
	settings_json JSON,
	runtime_config_version BIGINT UNSIGNED NOT NULL DEFAULT '1',
	enabled BOOL NOT NULL DEFAULT false,
	catalog_state_json JSON,
	catalog_synced_at DATETIME(6),
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id),
	CONSTRAINT uk_llm_connections_provider_name UNIQUE (provider_code, name),
	CONSTRAINT ck_llm_connections_version CHECK (runtime_config_version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='模型接入商的一套独立凭据与连接设置';

CREATE TABLE llm_models (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	display_name VARCHAR(128) NOT NULL,
	developer_name VARCHAR(128),
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户选择的稳定逻辑模型';

CREATE TABLE llm_model_routes (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	model_id BIGINT UNSIGNED NOT NULL,
	connection_id BIGINT UNSIGNED NOT NULL,
	target_kind VARCHAR(16) NOT NULL,
	invoke_target VARCHAR(256) NOT NULL,
	catalog_model_id VARCHAR(256),
	identifier_kind VARCHAR(16) NOT NULL DEFAULT 'unknown',
	origin VARCHAR(16) NOT NULL,
	metadata_json JSON,
	pricing_json JSON,
	target_available BOOL,
	enabled BOOL NOT NULL DEFAULT false,
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id),
	CONSTRAINT uk_llm_routes_connection_target UNIQUE (connection_id, target_kind, invoke_target),
	CONSTRAINT ck_llm_routes_target_kind CHECK (target_kind IN ('model', 'endpoint', 'deployment')),
	CONSTRAINT ck_llm_routes_identifier_kind CHECK (identifier_kind IN ('pinned', 'alias', 'unknown')),
	CONSTRAINT ck_llm_routes_origin CHECK (origin IN ('catalog', 'management', 'manual')),
	CONSTRAINT fk_llm_routes_model FOREIGN KEY(model_id) REFERENCES llm_models (id) ON DELETE RESTRICT,
	CONSTRAINT fk_llm_routes_connection FOREIGN KEY(connection_id) REFERENCES llm_provider_connections (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='逻辑模型在一条接入商连接上的实际调用目标';

CREATE INDEX idx_llm_routes_model_enabled ON llm_model_routes (model_id, enabled, id);

CREATE TABLE llm_use_case_routes (
	use_case VARCHAR(48) NOT NULL,
	route_id BIGINT UNSIGNED NOT NULL,
	protocol_code VARCHAR(32) NOT NULL,
	priority INTEGER NOT NULL,
	enabled BOOL NOT NULL DEFAULT false,
	validated_fingerprint VARCHAR(64),
	validated_at DATETIME(6),
	updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	PRIMARY KEY (use_case, route_id),
	CONSTRAINT uk_llm_use_case_priority UNIQUE (use_case, priority),
	CONSTRAINT ck_llm_use_case_priority CHECK (priority >= 0),
	CONSTRAINT fk_llm_use_case_route FOREIGN KEY(route_id) REFERENCES llm_model_routes (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统能力和对话列表共用的场景线路绑定';

CREATE INDEX idx_llm_use_case_routes_route ON llm_use_case_routes (route_id);

CREATE TABLE llm_call_logs (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	call_id VARCHAR(40) NOT NULL,
	use_case VARCHAR(48) NOT NULL,
	source VARCHAR(32) NOT NULL,
	user_id BIGINT UNSIGNED,
	agent_run_id BIGINT UNSIGNED,
	route_id BIGINT UNSIGNED NOT NULL,
	runtime_config_version BIGINT UNSIGNED NOT NULL,
	protocol_code VARCHAR(32) NOT NULL,
	response_model_id VARCHAR(256),
	upstream_request_id VARCHAR(128),
	selection_source VARCHAR(24) NOT NULL,
	status VARCHAR(16) NOT NULL DEFAULT 'pending',
	usage_json JSON,
	input_tokens BIGINT UNSIGNED,
	output_tokens BIGINT UNSIGNED,
	metering_status VARCHAR(16) NOT NULL DEFAULT 'unknown',
	price_snapshot_json JSON,
	estimated_cost NUMERIC(20, 10),
	cost_currency VARCHAR(3),
	latency_ms BIGINT UNSIGNED,
	error_code VARCHAR(64),
	created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	PRIMARY KEY (id),
	CONSTRAINT uk_llm_call_logs_call_id UNIQUE (call_id),
	CONSTRAINT ck_llm_calls_status CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT ck_llm_calls_metering CHECK (metering_status IN ('complete', 'partial', 'unknown')),
	CONSTRAINT ck_llm_calls_cost CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
	CONSTRAINT ck_llm_calls_currency CHECK (estimated_cost IS NULL OR cost_currency IS NOT NULL),
	CONSTRAINT fk_llm_calls_user FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT,
	CONSTRAINT fk_llm_calls_run FOREIGN KEY(agent_run_id) REFERENCES agent_runs (id) ON DELETE SET NULL,
	CONSTRAINT fk_llm_calls_route FOREIGN KEY(route_id) REFERENCES llm_model_routes (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='每次上游请求的安全计量与费用快照';

CREATE INDEX idx_llm_calls_created ON llm_call_logs (created_at, id);

CREATE INDEX idx_llm_calls_route_created ON llm_call_logs (route_id, created_at, id);

CREATE INDEX idx_llm_calls_run_created ON llm_call_logs (agent_run_id, created_at, id);

CREATE INDEX idx_llm_calls_user_created ON llm_call_logs (user_id, created_at, id);

ALTER TABLE agent_sessions ADD COLUMN selected_llm_model_id BIGINT UNSIGNED NULL COMMENT '会话选中的逻辑模型，空表示跟随默认', ADD CONSTRAINT fk_agent_sessions_llm_model FOREIGN KEY (selected_llm_model_id) REFERENCES llm_models (id) ON DELETE RESTRICT;

ALTER TABLE agent_runs DROP COLUMN model_config_id, DROP COLUMN model_config_version, ADD COLUMN resolved_llm_model_id BIGINT UNSIGNED NULL COMMENT '本轮冻结的逻辑模型', ADD COLUMN resolved_llm_route_id BIGINT UNSIGNED NULL COMMENT '本轮冻结的线路', ADD COLUMN runtime_config_version BIGINT UNSIGNED NULL COMMENT '本轮连接配置版本', ADD COLUMN protocol_code VARCHAR(32) NULL COMMENT '本轮调用协议', ADD COLUMN selection_source VARCHAR(24) NULL COMMENT '本轮模型选择来源', ADD COLUMN resolved_price_snapshot_json JSON NULL COMMENT '本轮冻结的价格规则', ADD COLUMN cost_currency VARCHAR(3) NULL COMMENT '运行费用币种', ADD CONSTRAINT fk_agent_runs_llm_model FOREIGN KEY (resolved_llm_model_id) REFERENCES llm_models (id) ON DELETE RESTRICT, ADD CONSTRAINT fk_agent_runs_llm_route FOREIGN KEY (resolved_llm_route_id) REFERENCES llm_model_routes (id) ON DELETE RESTRICT;
