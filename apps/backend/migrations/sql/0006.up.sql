-- 0006 升级迁移：新增统一大模型基础设施。
CREATE TABLE llm_model_configs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '模型配置主键',
  model_name VARCHAR(128) NOT NULL COMMENT 'LiteLLM 模型标识',
  api_base VARCHAR(512) NULL COMMENT '模型服务基础地址',
  encrypted_api_key TEXT NULL COMMENT '版本化加密凭据，禁止保存明文',
  enabled BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否启用模型配置',
  priority SMALLINT UNSIGNED NOT NULL DEFAULT 100
    COMMENT '调用优先级，数值越小越优先',
  input_price_per_million DECIMAL(18, 8) NULL
    COMMENT '每百万输入令牌的美元价格',
  output_price_per_million DECIMAL(18, 8) NULL
    COMMENT '每百万输出令牌的美元价格',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    COMMENT '创建时间（UTC）',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    COMMENT '最后更新时间（UTC）',
  PRIMARY KEY (id),
  KEY idx_llm_model_configs_enabled_priority (enabled, priority, id),
  CONSTRAINT ck_llm_model_configs_input_price_nonnegative
    CHECK (input_price_per_million IS NULL OR input_price_per_million >= 0),
  CONSTRAINT ck_llm_model_configs_output_price_nonnegative
    CHECK (output_price_per_million IS NULL OR output_price_per_million >= 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='大模型连接、优先级与可选价格配置';

CREATE TABLE llm_call_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '调用日志主键',
  call_id VARCHAR(40) NOT NULL COMMENT '逻辑调用唯一标识',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '发起调用的用户主键',
  model_config_id BIGINT UNSIGNED NULL
    COMMENT '实际使用的模型配置主键，未选中模型时为空',
  model_name VARCHAR(128) NULL COMMENT '实际模型标识快照',
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    COMMENT '调用状态：pending（待处理）、succeeded（成功）、failed（失败）、cancelled（已取消）',
  metering_status VARCHAR(16) NOT NULL DEFAULT 'unknown'
    COMMENT '计量状态：complete（完整）、partial（部分）、unknown（未知）',
  input_tokens BIGINT UNSIGNED NULL COMMENT '输入令牌数量',
  output_tokens BIGINT UNSIGNED NULL COMMENT '输出令牌数量',
  input_price_per_million DECIMAL(18, 8) NULL
    COMMENT '每百万输入令牌的美元价格快照',
  output_price_per_million DECIMAL(18, 8) NULL
    COMMENT '每百万输出令牌的美元价格快照',
  estimated_cost DECIMAL(20, 10) NULL COMMENT '预估调用成本（美元）',
  latency_ms BIGINT UNSIGNED NULL COMMENT '调用耗时（毫秒）',
  error_code VARCHAR(64) NULL COMMENT '非敏感稳定错误码',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    COMMENT '调用创建时间（UTC）',
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
