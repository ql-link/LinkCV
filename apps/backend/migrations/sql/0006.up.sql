-- Up migration for 0006: add LLM infrastructure.
CREATE TABLE llm_model_configs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  model_name VARCHAR(128) NOT NULL COMMENT 'LiteLLM 模型标识',
  api_base VARCHAR(512) NULL COMMENT '自定义模型服务地址',
  encrypted_api_key TEXT NULL COMMENT '版本化加密凭据，不保存明文',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  priority SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  input_price_per_million DECIMAL(18, 8) NULL COMMENT 'USD/百万输入 Token',
  output_price_per_million DECIMAL(18, 8) NULL COMMENT 'USD/百万输出 Token',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_llm_model_configs_enabled_priority (enabled, priority, id),
  CONSTRAINT ck_llm_model_configs_input_price_nonnegative
    CHECK (input_price_per_million IS NULL OR input_price_per_million >= 0),
  CONSTRAINT ck_llm_model_configs_output_price_nonnegative
    CHECK (output_price_per_million IS NULL OR output_price_per_million >= 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='大模型连接、优先级与可选价格配置';

CREATE TABLE llm_call_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  call_id VARCHAR(40) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  model_config_id BIGINT UNSIGNED NULL,
  model_name VARCHAR(128) NULL COMMENT '调用时实际模型快照',
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    COMMENT 'pending/succeeded/failed/cancelled',
  metering_status VARCHAR(16) NOT NULL DEFAULT 'unknown'
    COMMENT 'complete/partial/unknown',
  input_tokens BIGINT UNSIGNED NULL,
  output_tokens BIGINT UNSIGNED NULL,
  input_price_per_million DECIMAL(18, 8) NULL,
  output_price_per_million DECIMAL(18, 8) NULL,
  estimated_cost DECIMAL(20, 10) NULL COMMENT 'USD 估算成本',
  latency_ms BIGINT UNSIGNED NULL,
  error_code VARCHAR(64) NULL COMMENT '非敏感稳定错误分类',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT uk_llm_call_logs_call_id UNIQUE (call_id),
  KEY idx_llm_call_logs_created (created_at, id),
  KEY idx_llm_call_logs_user_created (user_id, created_at, id),
  KEY idx_llm_call_logs_model_created (model_config_id, created_at, id),
  KEY idx_llm_call_logs_status_created (status, created_at, id),
  CONSTRAINT fk_llm_call_logs_user_id_users
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_llm_call_logs_model_config_id_llm_model_configs
    FOREIGN KEY (model_config_id) REFERENCES llm_model_configs (id) ON DELETE RESTRICT,
  CONSTRAINT ck_llm_call_logs_status
    CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT ck_llm_call_logs_metering_status
    CHECK (metering_status IN ('complete', 'partial', 'unknown')),
  CONSTRAINT ck_llm_call_logs_input_tokens_nonnegative
    CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CONSTRAINT ck_llm_call_logs_output_tokens_nonnegative
    CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CONSTRAINT ck_llm_call_logs_input_price_nonnegative
    CHECK (input_price_per_million IS NULL OR input_price_per_million >= 0),
  CONSTRAINT ck_llm_call_logs_output_price_nonnegative
    CHECK (output_price_per_million IS NULL OR output_price_per_million >= 0),
  CONSTRAINT ck_llm_call_logs_estimated_cost_nonnegative
    CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  CONSTRAINT ck_llm_call_logs_latency_nonnegative
    CHECK (latency_ms IS NULL OR latency_ms >= 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='大模型逻辑调用的状态、计量与成本快照';
