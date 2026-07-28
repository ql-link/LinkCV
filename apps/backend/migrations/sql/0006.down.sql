-- 0006 降级迁移：移除统一大模型基础设施。
-- 此操作会删除模型配置和调用审计数据，仅允许在受控环境中执行。
DROP TABLE llm_call_logs;
DROP TABLE llm_model_configs;
