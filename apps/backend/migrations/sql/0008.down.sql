-- 0008 降级迁移：移除 Chat 能力附加结构，保留旧模型配置与日志主体。
-- capability、adapter、source 等附加快照会丢失，仅允许在应用已回滚且有备份时执行。
DROP TABLE llm_capability_bindings;

ALTER TABLE llm_call_logs
  DROP INDEX idx_llm_call_logs_model_source_created,
  DROP CHECK ck_llm_call_logs_adapter_pair,
  DROP CHECK ck_llm_call_logs_source_not_blank,
  DROP COLUMN model_call_name,
  DROP COLUMN adapter,
  DROP COLUMN source,
  DROP COLUMN capability;

ALTER TABLE llm_model_configs
  DROP CHECK ck_llm_model_configs_config_version,
  DROP CHECK ck_llm_model_configs_adapter_pair,
  DROP INDEX uk_llm_model_configs_capability_id,
  DROP COLUMN config_version,
  DROP COLUMN model_call_name,
  DROP COLUMN adapter,
  DROP COLUMN capability;

ALTER TABLE llm_model_configs
  COMMENT='大模型连接、优先级与可选价格配置';
