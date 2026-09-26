-- 0088 升级迁移：引入供应商层，模型配置收缩为供应商目录中的模型。

CREATE TABLE llm_providers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '供应商主键',
  name VARCHAR(64) NOT NULL COMMENT '供应商显示名',
  base_url VARCHAR(512) NOT NULL COMMENT '模型调用的 OpenAI 兼容基础地址',
  encrypted_api_key TEXT NOT NULL COMMENT '版本化加密凭据，禁止保存明文',
  model_catalog_url VARCHAR(512) NOT NULL COMMENT '模型目录与价目同步地址',
  price_sync_status VARCHAR(16) NOT NULL DEFAULT 'unknown'
    COMMENT '目录同步状态：unknown（从未同步）、succeeded（同步成功）、failed（同步失败）',
  price_sync_error VARCHAR(64) NULL COMMENT '最近一次同步失败的稳定错误码',
  price_synced_at DATETIME(6) NULL COMMENT '最近一次成功同步时间（UTC）',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '供应商乐观锁版本',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    COMMENT '创建时间（UTC）',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    COMMENT '最后更新时间（UTC）',
  CONSTRAINT pk_llm_providers PRIMARY KEY (id),
  CONSTRAINT uk_llm_providers_name UNIQUE (name),
  CONSTRAINT ck_llm_providers_price_sync_status
    CHECK (price_sync_status IN ('unknown', 'succeeded', 'failed')),
  CONSTRAINT ck_llm_providers_version CHECK (version >= 1),
  CONSTRAINT ck_llm_providers_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT ck_llm_providers_base_url_not_blank
    CHECK (length(trim(base_url)) > 0),
  CONSTRAINT ck_llm_providers_catalog_url_not_blank
    CHECK (length(trim(model_catalog_url)) > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='模型供应商连接配置';

CREATE TABLE llm_provider_models (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '目录条目主键',
  provider_id BIGINT UNSIGNED NOT NULL COMMENT '所属供应商主键',
  model_id VARCHAR(128) NOT NULL COMMENT '供应商侧的模型标识，等于模型调用名',
  display_name VARCHAR(128) NULL COMMENT '供应商给出的展示名',
  context_length INT UNSIGNED NULL COMMENT '上下文窗口 token 数',
  max_output INT UNSIGNED NULL COMMENT '最大输出 token 数',
  input_modalities VARCHAR(64) NULL
    COMMENT '输入模态，逗号分隔，例如 text,image',
  supports_reasoning BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT '该模型是否支持推理输出',
  input_price_per_million DECIMAL(18, 8) NULL
    COMMENT '每百万输入 token 的美元价格',
  output_price_per_million DECIMAL(18, 8) NULL
    COMMENT '每百万输出 token 的美元价格',
  cache_read_price_per_million DECIMAL(18, 8) NULL
    COMMENT '每百万缓存读取 token 的美元价格',
  cache_write_price_per_million DECIMAL(18, 8) NULL
    COMMENT '每百万缓存写入 token 的美元价格',
  synced_at DATETIME(6) NOT NULL COMMENT '本次同步时间（UTC）',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    COMMENT '创建时间（UTC）',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    COMMENT '最后更新时间（UTC）',
  CONSTRAINT pk_llm_provider_models PRIMARY KEY (id),
  CONSTRAINT uk_llm_provider_models_provider_model UNIQUE (provider_id, model_id),
  CONSTRAINT fk_llm_provider_models_provider
    FOREIGN KEY (provider_id) REFERENCES llm_providers (id) ON DELETE RESTRICT,
  CONSTRAINT ck_llm_provider_models_input_price_nonnegative
    CHECK (input_price_per_million IS NULL OR input_price_per_million >= 0),
  CONSTRAINT ck_llm_provider_models_output_price_nonnegative
    CHECK (output_price_per_million IS NULL OR output_price_per_million >= 0),
  CONSTRAINT ck_llm_provider_models_cache_read_price_nonnegative
    CHECK (
      cache_read_price_per_million IS NULL
      OR cache_read_price_per_million >= 0
    ),
  CONSTRAINT ck_llm_provider_models_cache_write_price_nonnegative
    CHECK (
      cache_write_price_per_million IS NULL
      OR cache_write_price_per_million >= 0
    )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='供应商模型目录与价目的本地快照';

-- 供应商层取代了逐模型直连，因此清空旧的模型配置与验证证据。
-- 顺序受外键约束：先解除能力绑定对该配置与证据的引用，再删证据，
-- 然后把历史调用日志的引用置空（快照列保留），最后删配置。
UPDATE llm_capability_bindings
SET model_config_id = NULL,
    validation_id = NULL;

DELETE FROM llm_model_validations;

UPDATE llm_call_logs
SET model_config_id = NULL
WHERE model_config_id IS NOT NULL;

DELETE FROM llm_model_configs;

ALTER TABLE llm_model_configs
  DROP INDEX idx_llm_model_configs_enabled_priority,
  DROP CHECK ck_llm_model_configs_input_price_nonnegative,
  DROP CHECK ck_llm_model_configs_output_price_nonnegative,
  DROP CHECK ck_llm_model_configs_adapter_pair,
  DROP COLUMN model_name,
  DROP COLUMN adapter,
  DROP COLUMN api_base,
  DROP COLUMN encrypted_api_key,
  DROP COLUMN enabled,
  DROP COLUMN priority,
  DROP COLUMN input_price_per_million,
  DROP COLUMN output_price_per_million,
  MODIFY COLUMN model_call_name VARCHAR(128) NOT NULL
    COMMENT '供应商目录中的模型标识',
  ADD COLUMN provider_id BIGINT UNSIGNED NOT NULL COMMENT '所属供应商主键'
    AFTER id,
  ADD CONSTRAINT ck_llm_model_configs_model_call_name
    CHECK (
      length(trim(model_call_name)) > 0 AND length(model_call_name) <= 128
    ),
  ADD CONSTRAINT fk_llm_model_configs_provider
    FOREIGN KEY (provider_id) REFERENCES llm_providers (id) ON DELETE RESTRICT,
  ADD KEY idx_llm_model_configs_provider (provider_id, id),
  COMMENT='供应商目录中的可调用模型';

-- 调用日志结构保持不变以保留历史快照，只更新已失去来源的列注释。
ALTER TABLE llm_call_logs
  MODIFY COLUMN adapter VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT '历史调用的接入类型快照，0088 起的新调用不再写入';
