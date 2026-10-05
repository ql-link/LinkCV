-- 0111: add missing column comments and make resume_templates.sort_order unsigned.
-- Column definitions are unchanged apart from COMMENT and the sign of sort_order.

ALTER TABLE `llm_provider_connections`
	MODIFY COLUMN `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '接入商连接主键',
	MODIFY COLUMN `provider_code` varchar(32) NOT NULL COMMENT '接入商协议代码，例如 openai、anthropic',
	MODIFY COLUMN `name` varchar(128) NOT NULL COMMENT '连接显示名称，同一接入商内唯一',
	MODIFY COLUMN `credential_ciphertext` text COMMENT '版本化加密后的接入凭据密文，不保存明文',
	MODIFY COLUMN `settings_json` json DEFAULT NULL COMMENT '连接设置，例如自定义 Base URL 与请求头',
	MODIFY COLUMN `runtime_config_version` bigint unsigned NOT NULL DEFAULT '1' COMMENT '运行时配置版本，配置变化时递增，用于让缓存失效',
	MODIFY COLUMN `enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否启用：1 是，0 否',
	MODIFY COLUMN `catalog_state_json` json DEFAULT NULL COMMENT '最近一次模型目录同步的状态与摘要',
	MODIFY COLUMN `catalog_synced_at` datetime(6) DEFAULT NULL COMMENT '最近一次模型目录同步完成时间（UTC）',
	MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
	MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）';

ALTER TABLE `llm_models`
	MODIFY COLUMN `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '逻辑模型主键',
	MODIFY COLUMN `display_name` varchar(128) NOT NULL COMMENT '展示给用户和管理员的模型名称',
	MODIFY COLUMN `developer_name` varchar(128) DEFAULT NULL COMMENT '模型开发方名称，例如 OpenAI',
	MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
	MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）';

ALTER TABLE `llm_model_routes`
	MODIFY COLUMN `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '模型线路主键',
	MODIFY COLUMN `model_id` bigint unsigned NOT NULL COMMENT '所属逻辑模型 ID',
	MODIFY COLUMN `connection_id` bigint unsigned NOT NULL COMMENT '所属接入商连接 ID',
	MODIFY COLUMN `target_kind` varchar(16) NOT NULL COMMENT '调用目标类型：model/endpoint/deployment',
	MODIFY COLUMN `invoke_target` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL COMMENT '实际调用目标标识，区分大小写',
	MODIFY COLUMN `catalog_model_id` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin DEFAULT NULL COMMENT '接入商模型目录中的原始模型 ID，区分大小写',
	MODIFY COLUMN `identifier_kind` varchar(16) NOT NULL DEFAULT 'unknown' COMMENT '目标标识类型：pinned 固定版本，alias 别名，unknown 未知',
	MODIFY COLUMN `origin` varchar(16) NOT NULL COMMENT '线路来源：catalog 目录同步，management 管理端创建，manual 手工录入',
	MODIFY COLUMN `metadata_json` json DEFAULT NULL COMMENT '上游模型能力与上下文等元数据',
	MODIFY COLUMN `pricing_json` json DEFAULT NULL COMMENT '价格配置快照',
	MODIFY COLUMN `target_available` tinyint(1) DEFAULT NULL COMMENT '上游目标是否可用：1 是，0 否，NULL 尚未探测',
	MODIFY COLUMN `enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否启用：1 是，0 否',
	MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
	MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）';

ALTER TABLE `llm_use_case_routes`
	MODIFY COLUMN `use_case` varchar(48) NOT NULL COMMENT '业务场景代码，例如 chat、mock_interview',
	MODIFY COLUMN `route_id` bigint unsigned NOT NULL COMMENT '绑定的模型线路 ID',
	MODIFY COLUMN `protocol_code` varchar(32) NOT NULL COMMENT '调用该线路时使用的协议代码',
	MODIFY COLUMN `priority` int unsigned NOT NULL COMMENT '同一场景内的优先级，数字越小越优先',
	MODIFY COLUMN `enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否启用：1 是，0 否',
	MODIFY COLUMN `validated_fingerprint` varchar(64) DEFAULT NULL COMMENT '最近一次验证通过时的线路配置指纹',
	MODIFY COLUMN `validated_at` datetime(6) DEFAULT NULL COMMENT '最近一次验证通过的时间（UTC）',
	MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）';

ALTER TABLE `llm_call_logs`
	MODIFY COLUMN `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '调用日志主键',
	MODIFY COLUMN `call_id` varchar(40) NOT NULL COMMENT '调用唯一标识，用于幂等记录',
	MODIFY COLUMN `use_case` varchar(48) NOT NULL COMMENT '发起调用的业务场景代码',
	MODIFY COLUMN `source` varchar(32) NOT NULL COMMENT '调用来源模块，例如 pi_agent、mock_interview、capability_probe',
	MODIFY COLUMN `user_id` bigint unsigned DEFAULT NULL COMMENT '发起调用的用户 ID，系统调用为空',
	MODIFY COLUMN `agent_run_id` bigint unsigned DEFAULT NULL COMMENT '关联的 Agent 运行 ID，非 Agent 调用为空',
	MODIFY COLUMN `route_id` bigint unsigned NOT NULL COMMENT '实际使用的模型线路 ID',
	MODIFY COLUMN `runtime_config_version` bigint unsigned NOT NULL COMMENT '调用时连接的运行时配置版本',
	MODIFY COLUMN `protocol_code` varchar(32) NOT NULL COMMENT '调用使用的协议代码',
	MODIFY COLUMN `response_model_id` varchar(256) DEFAULT NULL COMMENT '上游响应中返回的实际模型 ID',
	MODIFY COLUMN `upstream_request_id` varchar(128) DEFAULT NULL COMMENT '上游返回的请求 ID，用于对账排查',
	MODIFY COLUMN `selection_source` varchar(24) NOT NULL COMMENT '线路选择来源：user 用户指定，default 默认，fallback 降级，probe 探测',
	MODIFY COLUMN `status` varchar(16) NOT NULL DEFAULT 'pending' COMMENT '调用状态：pending/succeeded/failed/cancelled',
	MODIFY COLUMN `usage_json` json DEFAULT NULL COMMENT '上游返回的原始用量信息',
	MODIFY COLUMN `input_tokens` bigint unsigned DEFAULT NULL COMMENT '输入 Token 数',
	MODIFY COLUMN `output_tokens` bigint unsigned DEFAULT NULL COMMENT '输出 Token 数',
	MODIFY COLUMN `metering_status` varchar(16) NOT NULL DEFAULT 'unknown' COMMENT '计量完整性：complete/partial/unknown',
	MODIFY COLUMN `price_snapshot_json` json DEFAULT NULL COMMENT '调用时的价格快照',
	MODIFY COLUMN `estimated_cost` decimal(20,10) DEFAULT NULL COMMENT '按价格快照估算的费用',
	MODIFY COLUMN `cost_currency` varchar(3) DEFAULT NULL COMMENT '费用币种，ISO 4217 三位代码',
	MODIFY COLUMN `latency_ms` bigint unsigned DEFAULT NULL COMMENT '调用耗时（毫秒）',
	MODIFY COLUMN `error_code` varchar(64) DEFAULT NULL COMMENT '失败时的错误码',
	MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）';

ALTER TABLE `mock_interviews`
	MODIFY COLUMN `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '模拟面试主键',
	MODIFY COLUMN `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '对外暴露的 UUID 标识',
	MODIFY COLUMN `user_id` bigint unsigned NOT NULL COMMENT '所属用户 ID',
	MODIFY COLUMN `job_application_id` bigint unsigned DEFAULT NULL COMMENT '来源求职记录 ID，按求职记录发起时有值',
	MODIFY COLUMN `resume_id` bigint unsigned DEFAULT NULL COMMENT '来源简历 ID',
	MODIFY COLUMN `job_description_id` bigint unsigned DEFAULT NULL COMMENT '来源岗位描述 ID',
	MODIFY COLUMN `resume_title_snapshot` varchar(200) NOT NULL COMMENT '发起时的简历标题快照',
	MODIFY COLUMN `resume_markdown_snapshot` mediumtext NOT NULL COMMENT '发起时的简历正文快照',
	MODIFY COLUMN `target_role` varchar(200) DEFAULT NULL COMMENT '目标岗位名称',
	MODIFY COLUMN `interview_type` varchar(24) NOT NULL COMMENT '面试类型：technical/project_deep_dive/hr/comprehensive',
	MODIFY COLUMN `difficulty` varchar(16) NOT NULL COMMENT '难度：junior/intermediate/senior',
	MODIFY COLUMN `question_count` tinyint unsigned NOT NULL COMMENT '主问题数量，3 到 10',
	MODIFY COLUMN `follow_up_enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否开启追问：1 是，0 否',
	MODIFY COLUMN `language` varchar(8) NOT NULL COMMENT '面试语言：zh/en',
	MODIFY COLUMN `status` varchar(24) NOT NULL COMMENT '面试状态：preparing/preparation_failed/in_progress/evaluating/evaluation_failed/completed/abandoned',
	MODIFY COLUMN `current_question_id` bigint unsigned DEFAULT NULL COMMENT '当前正在作答的问题 ID',
	MODIFY COLUMN `started_at` datetime(6) DEFAULT NULL COMMENT '开始作答时间（UTC）',
	MODIFY COLUMN `finished_at` datetime(6) DEFAULT NULL COMMENT '结束时间（UTC）',
	MODIFY COLUMN `last_activity_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '最近一次活动时间（UTC）',
	MODIFY COLUMN `total_score` decimal(5,2) DEFAULT NULL COMMENT '总分 0-100，评估完成后有值',
	MODIFY COLUMN `low_confidence` tinyint(1) NOT NULL DEFAULT '0' COMMENT '评分是否低置信：1 是，0 否',
	MODIFY COLUMN `report_json` json DEFAULT NULL COMMENT '评估报告',
	MODIFY COLUMN `rubric_version` varchar(16) DEFAULT NULL COMMENT '评分标准版本',
	MODIFY COLUMN `error_code` varchar(64) DEFAULT NULL COMMENT '准备或评估失败时的错误码',
	MODIFY COLUMN `input_tokens` bigint unsigned NOT NULL DEFAULT '0' COMMENT '累计输入 Token 数',
	MODIFY COLUMN `output_tokens` bigint unsigned NOT NULL DEFAULT '0' COMMENT '累计输出 Token 数',
	MODIFY COLUMN `lock_version` bigint unsigned NOT NULL DEFAULT '1' COMMENT '乐观锁版本，从 1 开始',
	MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
	MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）';

ALTER TABLE `mock_interview_questions`
	MODIFY COLUMN `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '问题主键',
	MODIFY COLUMN `interview_id` bigint unsigned NOT NULL COMMENT '所属模拟面试 ID',
	MODIFY COLUMN `depth_level` tinyint unsigned NOT NULL COMMENT '追问深度，主问题为 1，最多 5',
	MODIFY COLUMN `content` text NOT NULL COMMENT '问题内容',
	MODIFY COLUMN `answer_status` varchar(16) NOT NULL DEFAULT 'pending' COMMENT '作答状态：pending/answered/skipped',
	MODIFY COLUMN `answer_text` text COMMENT '作答内容，已作答时有值',
	MODIFY COLUMN `answer_idempotency_key` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '作答请求的幂等键',
	MODIFY COLUMN `answered_at` datetime(6) DEFAULT NULL COMMENT '作答或跳过时间（UTC）',
	MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
	MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）';

ALTER TABLE `resume_change_proposals`
	MODIFY COLUMN `proposed_data_json` json DEFAULT NULL COMMENT '提案生成的完整候选简历内容',
	MODIFY COLUMN `proposed_style_json` json DEFAULT NULL COMMENT '提案生成的完整候选简历样式';

ALTER TABLE `resume_templates`
	MODIFY COLUMN `sort_order` int unsigned NOT NULL DEFAULT '1000' COMMENT '模板展示顺序，数字越小越靠前；相同值按 ID 排序';
