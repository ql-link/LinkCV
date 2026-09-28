-- Restore the LiteLLM config columns only for databases that applied the
-- original 0088 provider-layer migration. The Python revision requires the
-- provider table to be empty and all capability bindings to be unbound.
-- Provider catalog tables remain intact for audit/recovery; no credentials
-- or historical model configs are fabricated.

ALTER TABLE llm_call_logs
  MODIFY COLUMN adapter VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT '实际 LiteLLM adapter 快照';

ALTER TABLE llm_model_configs
  DROP FOREIGN KEY fk_llm_model_configs_provider,
  DROP INDEX idx_llm_model_configs_provider,
  DROP CHECK ck_llm_model_configs_model_call_name,
  DROP COLUMN provider_id,
  ADD COLUMN model_name VARCHAR(128) NOT NULL COMMENT 'LiteLLM 模型标识' AFTER id,
  ADD COLUMN adapter VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT 'LiteLLM adapter 标识' AFTER model_name,
  MODIFY COLUMN model_call_name VARCHAR(128) NULL
    COMMENT '不含 adapter 前缀的模型调用名',
  ADD COLUMN api_base VARCHAR(512) NULL COMMENT '模型服务基础地址'
    AFTER model_call_name,
  ADD COLUMN encrypted_api_key TEXT NULL COMMENT '版本化加密凭据，禁止保存明文'
    AFTER api_base,
  ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否启用模型配置'
    AFTER encrypted_api_key,
  ADD COLUMN priority SMALLINT UNSIGNED NOT NULL DEFAULT 100
    COMMENT '调用优先级，数值越小越优先' AFTER enabled,
  ADD COLUMN input_price_per_million DECIMAL(18, 8) NULL
    COMMENT '每百万输入令牌的美元价格' AFTER priority,
  ADD COLUMN output_price_per_million DECIMAL(18, 8) NULL
    COMMENT '每百万输出令牌的美元价格' AFTER input_price_per_million,
  ADD KEY idx_llm_model_configs_enabled_priority (enabled, priority, id),
  ADD CONSTRAINT ck_llm_model_configs_input_price_nonnegative
    CHECK (input_price_per_million IS NULL OR input_price_per_million >= 0),
  ADD CONSTRAINT ck_llm_model_configs_output_price_nonnegative
    CHECK (output_price_per_million IS NULL OR output_price_per_million >= 0),
  ADD CONSTRAINT ck_llm_model_configs_adapter_pair CHECK (
    (adapter IS NULL AND model_call_name IS NULL) OR
    (adapter IS NOT NULL AND model_call_name IS NOT NULL
      AND LENGTH(TRIM(adapter)) > 0
      AND LENGTH(TRIM(model_call_name)) > 0
      AND LENGTH(adapter) + 1 + LENGTH(model_call_name) <= 128)
  ),
  COMMENT='能力中立的模型连接配置';
