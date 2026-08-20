-- Up migration for 0023: independent Pi Agent service business state.

ALTER TABLE resume_versions
  DROP CHECK ck_resume_versions_reason,
  ADD CONSTRAINT ck_resume_versions_reason
    CHECK (reason IN ('initial', 'manual', 'before_restore', 'restore', 'agent'));

CREATE TABLE agent_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '会话内部主键',
  public_id CHAR(36) NOT NULL COMMENT '对外不可预测 UUID',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '会话所有者',
  resume_id BIGINT UNSIGNED NULL COMMENT '当前绑定简历',
  pi_session_id VARCHAR(128) NULL COMMENT 'Pi 持久会话标识',
  title VARCHAR(128) NOT NULL COMMENT '会话标题',
  status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active、archived',
  last_message_at DATETIME(6) NULL COMMENT '最近消息时间 UTC',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间 UTC',
  CONSTRAINT pk_agent_sessions PRIMARY KEY (id),
  CONSTRAINT uk_agent_sessions_public_id UNIQUE (public_id),
  CONSTRAINT ck_agent_sessions_status CHECK (status IN ('active', 'archived')),
  INDEX idx_agent_sessions_user_updated (user_id, updated_at, id),
  INDEX idx_agent_sessions_resume_updated (resume_id, updated_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户智能助手会话';

CREATE TABLE agent_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '运行内部主键',
  public_id CHAR(36) NOT NULL COMMENT '对外不可预测 UUID',
  session_id BIGINT UNSIGNED NOT NULL COMMENT '所属会话',
  idempotency_key VARCHAR(64) NOT NULL COMMENT '客户端消息幂等键',
  status VARCHAR(16) NOT NULL DEFAULT 'running' COMMENT 'running、succeeded、failed、cancelled',
  model_config_id BIGINT UNSIGNED NULL COMMENT '实际使用模型配置',
  model_config_version BIGINT UNSIGNED NULL COMMENT '实际模型配置版本',
  error_code VARCHAR(64) NULL COMMENT '安全化失败码',
  input_tokens BIGINT UNSIGNED NULL COMMENT '输入令牌数',
  output_tokens BIGINT UNSIGNED NULL COMMENT '输出令牌数',
  estimated_cost DECIMAL(18,8) NULL COMMENT '预估美元费用',
  started_at DATETIME(6) NOT NULL COMMENT '开始时间 UTC',
  completed_at DATETIME(6) NULL COMMENT '结束时间 UTC',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间 UTC',
  CONSTRAINT pk_agent_runs PRIMARY KEY (id),
  CONSTRAINT uk_agent_runs_public_id UNIQUE (public_id),
  CONSTRAINT uk_agent_runs_session_idempotency UNIQUE (session_id, idempotency_key),
  CONSTRAINT ck_agent_runs_status CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT ck_agent_runs_input_tokens_nonnegative CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CONSTRAINT ck_agent_runs_output_tokens_nonnegative CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CONSTRAINT ck_agent_runs_cost_nonnegative CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  INDEX idx_agent_runs_session_created (session_id, created_at, id),
  INDEX idx_agent_runs_status_updated (status, updated_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='智能助手单次运行';

CREATE TABLE agent_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '消息主键',
  session_id BIGINT UNSIGNED NOT NULL COMMENT '所属会话',
  run_id BIGINT UNSIGNED NULL COMMENT '产生或消费该消息的运行',
  sequence_no BIGINT UNSIGNED NOT NULL COMMENT '会话内严格递增序号',
  role VARCHAR(16) NOT NULL COMMENT 'user、assistant',
  content MEDIUMTEXT NOT NULL COMMENT '消息正文',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  CONSTRAINT pk_agent_messages PRIMARY KEY (id),
  CONSTRAINT uk_agent_messages_session_sequence UNIQUE (session_id, sequence_no),
  CONSTRAINT ck_agent_messages_role CHECK (role IN ('user', 'assistant')),
  INDEX idx_agent_messages_session_created (session_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='智能助手对话消息';

CREATE TABLE agent_tool_calls (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '工具调用主键',
  run_id BIGINT UNSIGNED NOT NULL COMMENT '所属运行',
  call_key VARCHAR(128) NOT NULL COMMENT '运行内工具幂等标识',
  tool_name VARCHAR(64) NOT NULL COMMENT '受控工具名',
  target_type VARCHAR(32) NULL COMMENT '安全化目标类型',
  target_id VARCHAR(64) NULL COMMENT '安全化目标标识',
  status VARCHAR(16) NOT NULL DEFAULT 'running' COMMENT 'running、succeeded、failed、cancelled',
  error_code VARCHAR(64) NULL COMMENT '安全化失败码',
  duration_ms BIGINT UNSIGNED NULL COMMENT '耗时毫秒',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间 UTC',
  CONSTRAINT pk_agent_tool_calls PRIMARY KEY (id),
  CONSTRAINT uk_agent_tool_calls_run_key UNIQUE (run_id, call_key),
  CONSTRAINT ck_agent_tool_calls_status CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  INDEX idx_agent_tool_calls_run_created (run_id, created_at, id),
  INDEX idx_agent_tool_calls_tool_created (tool_name, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='受控智能助手工具调用审计';

CREATE TABLE resume_change_proposals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '修改提案内部主键',
  public_id CHAR(36) NOT NULL COMMENT '对外不可预测 UUID',
  run_id BIGINT UNSIGNED NOT NULL COMMENT '来源 Agent 运行',
  call_key VARCHAR(128) NOT NULL COMMENT '运行内提案幂等标识',
  resume_id BIGINT UNSIGNED NOT NULL COMMENT '目标简历',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '提案所有者',
  base_lock_version BIGINT UNSIGNED NOT NULL COMMENT '生成提案时简历乐观锁版本',
  proposed_data_json JSON NOT NULL COMMENT '完整 ResumeDocumentV1 提案',
  proposed_style_json JSON NOT NULL COMMENT '完整 ResumeStyleV1 提案',
  summary TEXT NOT NULL COMMENT '面向用户的修改摘要',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending、applied、rejected、expired、conflicted',
  applied_lock_version BIGINT UNSIGNED NULL COMMENT '应用后的简历锁版本',
  expires_at DATETIME(6) NOT NULL COMMENT '确认截止时间 UTC',
  applied_at DATETIME(6) NULL COMMENT '应用时间 UTC',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间 UTC',
  CONSTRAINT pk_resume_change_proposals PRIMARY KEY (id),
  CONSTRAINT uk_resume_change_proposals_public_id UNIQUE (public_id),
  CONSTRAINT uk_resume_change_proposals_run_call_key UNIQUE (run_id, call_key),
  CONSTRAINT ck_resume_change_proposals_status CHECK (status IN ('pending', 'applied', 'rejected', 'expired', 'conflicted')),
  CONSTRAINT ck_resume_change_proposals_lock_versions CHECK (base_lock_version >= 1 AND (applied_lock_version IS NULL OR applied_lock_version >= base_lock_version)),
  INDEX idx_resume_change_proposals_user_created (user_id, created_at, id),
  INDEX idx_resume_change_proposals_resume_status_created (resume_id, status, created_at, id),
  INDEX idx_resume_change_proposals_pending_expiry (status, expires_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户确认前的简历修改提案';
