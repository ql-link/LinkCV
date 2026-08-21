-- 0028 contract: candidate configs no longer carry a capability dimension.

ALTER TABLE llm_model_configs
  DROP INDEX uk_llm_model_configs_capability_id,
  DROP COLUMN capability,
  COMMENT='能力中立的模型连接配置';
