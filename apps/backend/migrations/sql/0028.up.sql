-- 0028 expand: make candidate configs capability-neutral and add validation evidence.

ALTER TABLE llm_call_logs
  ADD COLUMN model_config_version BIGINT UNSIGNED NULL
    COMMENT '实际模型配置版本快照，未选中模型时为空' AFTER model_config_id,
  ADD CONSTRAINT ck_llm_call_logs_model_config_version
    CHECK (model_config_version IS NULL OR model_config_version >= 1);

CREATE TABLE llm_model_validations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '模型验证主键',
  model_config_id BIGINT UNSIGNED NOT NULL COMMENT '被验证候选主键',
  config_version BIGINT UNSIGNED NOT NULL COMMENT '被验证候选版本',
  capability VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    COMMENT '目标模型能力',
  probe_version BIGINT UNSIGNED NOT NULL COMMENT '验证探针版本',
  runtime_version VARCHAR(64) NULL COMMENT '执行组件版本',
  call_id VARCHAR(40) NOT NULL COMMENT '对应逻辑调用标识',
  status VARCHAR(16) NOT NULL COMMENT '验证状态',
  error_code VARCHAR(64) NULL COMMENT '非敏感稳定错误码',
  created_by_user_id BIGINT UNSIGNED NOT NULL COMMENT '发起验证的管理员主键',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    COMMENT '创建时间（UTC）',
  CONSTRAINT pk_llm_model_validations PRIMARY KEY (id),
  CONSTRAINT uk_llm_model_validations_call_id UNIQUE (call_id),
  KEY idx_llm_model_validations_latest
    (model_config_id, capability, config_version, created_at, id),
  CONSTRAINT fk_llm_model_validations_model
    FOREIGN KEY (model_config_id) REFERENCES llm_model_configs (id) ON DELETE RESTRICT,
  CONSTRAINT fk_llm_model_validations_call
    FOREIGN KEY (call_id) REFERENCES llm_call_logs (call_id) ON DELETE RESTRICT,
  CONSTRAINT fk_llm_model_validations_creator
    FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT ck_llm_model_validations_capability
    CHECK (capability IN ('chat', 'resume_structuring', 'pi_agent')),
  CONSTRAINT ck_llm_model_validations_status
    CHECK (status IN ('succeeded', 'failed', 'cancelled')),
  CONSTRAINT ck_llm_model_validations_versions
    CHECK (config_version >= 1 AND probe_version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='模型配置按能力和版本保存的验证证据';

ALTER TABLE llm_capability_bindings
  DROP FOREIGN KEY fk_llm_capability_bindings_model,
  DROP INDEX idx_llm_capability_bindings_capability_model;

ALTER TABLE llm_capability_bindings
  ADD COLUMN binding_version BIGINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '能力绑定乐观锁版本' AFTER model_config_id,
  ADD COLUMN validation_id BIGINT UNSIGNED NULL
    COMMENT '最近一次成功验证证据主键，存量 Chat 可为空' AFTER binding_version,
  ADD KEY idx_llm_capability_bindings_model (model_config_id, capability),
  ADD CONSTRAINT fk_llm_capability_bindings_model
    FOREIGN KEY (model_config_id) REFERENCES llm_model_configs (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_llm_capability_bindings_validation
    FOREIGN KEY (validation_id) REFERENCES llm_model_validations (id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_llm_capability_bindings_capability
    CHECK (capability IN ('chat', 'resume_structuring', 'pi_agent')),
  ADD CONSTRAINT ck_llm_capability_bindings_version
    CHECK (binding_version >= 1);

INSERT INTO llm_capability_bindings
  (capability, model_config_id, binding_version, validation_id, created_at, updated_at)
SELECT 'resume_structuring', NULL, 1, NULL, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM llm_capability_bindings WHERE capability = 'resume_structuring'
);

INSERT INTO llm_capability_bindings
  (capability, model_config_id, binding_version, validation_id, created_at, updated_at)
SELECT 'pi_agent', NULL, 1, NULL, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM llm_capability_bindings WHERE capability = 'pi_agent'
);
