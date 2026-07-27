-- Down migration for 0006: remove LLM infrastructure.
-- This deletes LLM configuration and audit data; use only in controlled environments.
DROP TABLE llm_call_logs;
DROP TABLE llm_model_configs;
