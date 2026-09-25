-- Upgrade migration for 0083: add agent operation trace
CREATE TABLE agent_operations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '操作内部主键',
  public_id CHAR(36) NOT NULL COMMENT '确定性操作 UUID，与后续运行公共 ID 一致',
  session_id BIGINT UNSIGNED NOT NULL COMMENT '已校验归属的会话 ID',
  state VARCHAR(20) NOT NULL COMMENT 'preflighting、failed、run_created',
  error_code VARCHAR(64) NULL COMMENT '运行创建前失败的稳定错误码',
  failure_stage VARCHAR(64) NULL COMMENT '预检或运行最终可判定的失败阶段',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '首次受理时间 UTC',
  CONSTRAINT pk_agent_operations PRIMARY KEY (id),
  CONSTRAINT uk_agent_operations_public_id UNIQUE (public_id),
  CONSTRAINT fk_agent_operations_session FOREIGN KEY (session_id)
    REFERENCES agent_sessions (id) ON DELETE RESTRICT,
  CONSTRAINT ck_agent_operations_state CHECK (state IN ('preflighting', 'failed', 'run_created')),
  INDEX idx_agent_operations_state_created (state, created_at, id),
  INDEX idx_agent_operations_created (created_at, id),
  INDEX idx_agent_operations_session (session_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='智能助手消息操作排障摘要';

CREATE TABLE agent_stage_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '阶段事件主键',
  agent_operation_id BIGINT UNSIGNED NOT NULL COMMENT '所属操作',
  event_key VARCHAR(160) NOT NULL COMMENT '服务端生成的逻辑事件幂等键',
  stage VARCHAR(64) NOT NULL COMMENT '受控阶段代码',
  result VARCHAR(16) NOT NULL COMMENT 'started、succeeded、failed、cancelled',
  tool_call_key VARCHAR(128) NULL COMMENT '工具调用关联键',
  proposal_id BIGINT UNSIGNED NULL COMMENT '提案内部 ID',
  error_code VARCHAR(64) NULL COMMENT '稳定错误码',
  duration_ms BIGINT UNSIGNED NULL COMMENT '耗时毫秒',
  occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'FastAPI 接受事件时间 UTC',
  CONSTRAINT pk_agent_stage_events PRIMARY KEY (id),
  CONSTRAINT uk_agent_stage_events_operation_key UNIQUE (agent_operation_id, event_key),
  CONSTRAINT fk_agent_stage_events_operation FOREIGN KEY (agent_operation_id)
    REFERENCES agent_operations (id) ON DELETE CASCADE,
  CONSTRAINT ck_agent_stage_events_result CHECK (result IN ('started', 'succeeded', 'failed', 'cancelled')),
  INDEX idx_agent_stage_events_operation_time (agent_operation_id, occurred_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='智能助手安全阶段事件';

CREATE INDEX idx_agent_runs_created ON agent_runs (created_at, id);

ALTER TABLE agent_runs
  ADD COLUMN model_name VARCHAR(128) NULL COMMENT '运行时请求的模型标识快照' AFTER model_config_version;

UPDATE agent_runs AS r
JOIN llm_model_configs AS m ON m.id = r.model_config_id
SET r.model_name = CONCAT(m.adapter, '/', m.model_call_name)
WHERE r.model_config_version = m.config_version
  AND m.adapter IS NOT NULL AND m.model_call_name IS NOT NULL;
