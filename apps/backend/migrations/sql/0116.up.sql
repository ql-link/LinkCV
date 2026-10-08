-- 0116: Additive cost accounting. No historical amounts are overwritten.

ALTER TABLE llm_model_route
    ADD COLUMN pricing_mode VARCHAR(16) NOT NULL DEFAULT 'provider' COMMENT '供应商价格或人工覆盖模式',
    ADD COLUMN current_price_revision_id BIGINT UNSIGNED NULL COMMENT '当前价格版本 ID';
-- Existing manually priced routes retain their override when full catalog rules are enabled.
UPDATE llm_model_route SET pricing_mode = 'manual_override'
WHERE origin = 'manual' AND pricing_json IS NOT NULL;
ALTER TABLE llm_call_log
    ADD COLUMN request_started_at DATETIME(6) NULL COMMENT '实际上游请求开始时间 UTC',
    ADD COLUMN request_finished_at DATETIME(6) NULL COMMENT '实际上游请求结束时间 UTC',
    ADD COLUMN time_basis VARCHAR(32) NULL COMMENT '请求时间的证据来源',
    ADD COLUMN normalized_usage_json JSON NULL COMMENT '互斥输入缓存及输出计费用量',
    ADD COLUMN price_revision_id BIGINT UNSIGNED NULL COMMENT '冻结价格版本 ID',
    ADD COLUMN cost_state VARCHAR(24) NOT NULL DEFAULT 'pending' COMMENT '估算对账待计价状态',
    ADD COLUMN cost_reason VARCHAR(48) NULL COMMENT '无法完整计价原因',
    ADD COLUMN current_cost_revision_id BIGINT UNSIGNED NULL COMMENT '当前费用版本 ID',
    ADD COLUMN settled_cost DECIMAL(20,10) UNSIGNED NULL COMMENT '供应商结算金额',
    ADD COLUMN settled_currency VARCHAR(3) NULL COMMENT '结算币种',
    ADD INDEX idx_llm_calls_request_started (request_started_at, id);

CREATE TABLE llm_price_revision (
	id BIGINT UNSIGNED NOT NULL COMMENT '自增主键' AUTO_INCREMENT,
	route_id BIGINT UNSIGNED NOT NULL COMMENT '模型线路 ID',
	rule_hash CHAR(64) NOT NULL COMMENT '完整规则的 SHA256 指纹',
	rule_json JSON NOT NULL COMMENT '冻结的完整计费规则',
	source VARCHAR(32) NOT NULL COMMENT '规则或费用的证据来源',
	observed_at DATETIME(6) NOT NULL COMMENT '规则读取时间 UTC',
	effective_from DATETIME(6) COMMENT '已核实的规则生效时间 UTC',
	create_time DATETIME(6) NOT NULL COMMENT '创建时间 UTC',
	update_time DATETIME(6) NOT NULL COMMENT '更新时间 UTC',
	PRIMARY KEY (id),
	CONSTRAINT uk_llm_price_revision_rule UNIQUE (route_id, rule_hash)
)COMMENT='模型线路不可变价格版本' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE llm_cost_operation (
	id BIGINT UNSIGNED NOT NULL COMMENT '自增主键' AUTO_INCREMENT,
	operation_key CHAR(36) NOT NULL COMMENT '操作公开 UUID',
	operation_type VARCHAR(24) NOT NULL COMMENT '补算或账单导入类型',
	idempotency_key VARCHAR(64) NOT NULL COMMENT '管理员提交的幂等键',
	actor_user_id BIGINT UNSIGNED NOT NULL COMMENT '操作管理员 ID',
	state VARCHAR(24) NOT NULL COMMENT '预览执行及冲突状态',
	scope_json JSON NOT NULL COMMENT '操作范围及确认依据',
	source_digest CHAR(64) NOT NULL COMMENT '不可变预览证据指纹',
	summary_json JSON NOT NULL COMMENT '有界操作统计',
	create_time DATETIME(6) NOT NULL COMMENT '创建时间 UTC',
	update_time DATETIME(6) NOT NULL COMMENT '更新时间 UTC',
	PRIMARY KEY (id),
	CONSTRAINT uk_llm_cost_operation_key UNIQUE (operation_key),
	CONSTRAINT uk_llm_cost_operation_idempotency UNIQUE (actor_user_id, idempotency_key)
)COMMENT='费用补算与账单导入操作' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_llm_cost_operation_created ON llm_cost_operation (create_time, id);

CREATE TABLE llm_call_cost_revision (
	id BIGINT UNSIGNED NOT NULL COMMENT '自增主键' AUTO_INCREMENT,
	call_log_id BIGINT UNSIGNED COMMENT '关联调用日志 ID',
	operation_id BIGINT UNSIGNED COMMENT '关联费用操作 ID',
	connection_id BIGINT UNSIGNED NOT NULL COMMENT '接入连接 ID',
	calculation_key CHAR(64) NOT NULL COMMENT '费用计算幂等指纹',
	source VARCHAR(32) NOT NULL COMMENT '规则或费用的证据来源',
	state VARCHAR(24) NOT NULL COMMENT '预览执行及冲突状态',
	reason VARCHAR(48) COMMENT '无法计价或冲突原因',
	price_revision_id BIGINT UNSIGNED COMMENT '冻结价格版本 ID',
	basis_json JSON NOT NULL COMMENT '原投影计费依据及逐项明细',
	estimated_cost DECIMAL(20, 10) UNSIGNED COMMENT '完整估算金额',
	cost_currency VARCHAR(3) COMMENT '估算币种',
	settled_cost DECIMAL(20, 10) UNSIGNED COMMENT '供应商结算金额',
	settled_currency VARCHAR(3) COMMENT '结算币种',
	provider_record_key VARCHAR(128) COLLATE utf8mb4_0900_bin COMMENT '供应商账单记录唯一 ID',
	provider_request_key VARCHAR(128) COLLATE utf8mb4_0900_bin COMMENT '供应商请求 ID',
	create_time DATETIME(6) NOT NULL COMMENT '创建时间 UTC',
	update_time DATETIME(6) NOT NULL COMMENT '更新时间 UTC',
	PRIMARY KEY (id),
	CONSTRAINT uk_llm_call_cost_calculation UNIQUE (calculation_key),
	CONSTRAINT uk_llm_call_cost_provider_record UNIQUE (connection_id, provider_record_key)
)COMMENT='逐次调用不可变费用证据' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_llm_call_cost_call ON llm_call_cost_revision (call_log_id, id);

CREATE INDEX idx_llm_call_cost_operation ON llm_call_cost_revision (operation_id, id);
