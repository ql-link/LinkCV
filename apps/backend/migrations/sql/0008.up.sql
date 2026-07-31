-- 0008 升级迁移：为系统 Chat 能力增加候选模型、唯一当前绑定与调用快照。
-- 旧候选池列暂时保留，供滚动发布和应用回滚兼容；新运行时不读取这些列。
ALTER TABLE llm_model_configs
  ADD COLUMN capability VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'chat' COMMENT '系统模型能力标识，当前仅 chat' AFTER id,
  ADD COLUMN adapter VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT 'LiteLLM adapter 标识' AFTER model_name,
  ADD COLUMN model_call_name VARCHAR(128) NULL
    COMMENT '不含 adapter 前缀的模型调用名' AFTER adapter,
  ADD COLUMN config_version BIGINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '模型候选乐观锁版本' AFTER output_price_per_million,
  ADD CONSTRAINT uk_llm_model_configs_capability_id
    UNIQUE (capability, id),
  ADD CONSTRAINT ck_llm_model_configs_adapter_pair CHECK (
    (adapter IS NULL AND model_call_name IS NULL) OR
    (adapter IS NOT NULL AND model_call_name IS NOT NULL
      AND LENGTH(TRIM(adapter)) > 0
      AND LENGTH(TRIM(model_call_name)) > 0
      AND LENGTH(adapter) + 1 + LENGTH(model_call_name) <= 128)
  ),
  ADD CONSTRAINT ck_llm_model_configs_config_version
    CHECK (config_version >= 1);

ALTER TABLE llm_model_configs
  COMMENT='系统模型能力的候选连接配置（含发布兼容列）';

CREATE TABLE llm_capability_bindings (
  capability VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    COMMENT '系统模型能力标识',
  model_config_id BIGINT UNSIGNED NULL COMMENT '当前候选模型配置主键，空表示未配置',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    COMMENT '创建时间（UTC）',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    COMMENT '最后更新时间（UTC）',
  CONSTRAINT pk_llm_capability_bindings PRIMARY KEY (capability),
  KEY idx_llm_capability_bindings_capability_model
    (capability, model_config_id),
  CONSTRAINT fk_llm_capability_bindings_model
    FOREIGN KEY (capability, model_config_id)
    REFERENCES llm_model_configs (capability, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='系统模型能力到唯一当前候选的低基数绑定';

INSERT INTO llm_capability_bindings
  (capability, model_config_id, created_at, updated_at)
VALUES ('chat', NULL, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6));

ALTER TABLE llm_call_logs
  ADD COLUMN capability VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'chat' COMMENT '实际模型能力快照' AFTER call_id,
  ADD COLUMN source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'connection_test' COMMENT '稳定调用来源代码' AFTER capability,
  ADD COLUMN adapter VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT '实际 LiteLLM adapter 快照' AFTER model_name,
  ADD COLUMN model_call_name VARCHAR(128) NULL
    COMMENT '实际模型调用名快照' AFTER adapter,
  ADD CONSTRAINT ck_llm_call_logs_source_not_blank
    CHECK (LENGTH(TRIM(source)) > 0),
  ADD CONSTRAINT ck_llm_call_logs_adapter_pair CHECK (
    (adapter IS NULL AND model_call_name IS NULL) OR
    (adapter IS NOT NULL AND model_call_name IS NOT NULL
      AND LENGTH(TRIM(adapter)) > 0
      AND LENGTH(TRIM(model_call_name)) > 0)
  ),
  ADD KEY idx_llm_call_logs_model_source_created
    (model_config_id, source, created_at, id);
