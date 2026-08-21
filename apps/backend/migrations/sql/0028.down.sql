-- 0028 down: restore the compatibility capability column for rollback.

ALTER TABLE llm_model_configs
  ADD COLUMN capability VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'chat' COMMENT '系统模型能力标识，回滚兼容列' AFTER id,
  ADD CONSTRAINT uk_llm_model_configs_capability_id UNIQUE (capability, id),
  COMMENT='系统模型能力的候选连接配置（含发布兼容列）';
