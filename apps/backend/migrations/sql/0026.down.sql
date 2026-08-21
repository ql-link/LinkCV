-- 0026 down: restore the pre-capability-expansion binding shape.

DELETE FROM llm_capability_bindings
WHERE capability IN ('resume_structuring', 'pi_agent');

ALTER TABLE llm_capability_bindings
  DROP CHECK ck_llm_capability_bindings_version,
  DROP CHECK ck_llm_capability_bindings_capability,
  DROP FOREIGN KEY fk_llm_capability_bindings_validation,
  DROP FOREIGN KEY fk_llm_capability_bindings_model,
  DROP INDEX idx_llm_capability_bindings_model,
  DROP COLUMN validation_id,
  DROP COLUMN binding_version;

ALTER TABLE llm_capability_bindings
  ADD KEY idx_llm_capability_bindings_capability_model
    (capability, model_config_id),
  ADD CONSTRAINT fk_llm_capability_bindings_model
    FOREIGN KEY (capability, model_config_id)
    REFERENCES llm_model_configs (capability, id) ON DELETE RESTRICT;

DROP TABLE llm_model_validations;

ALTER TABLE llm_call_logs
  DROP CHECK ck_llm_call_logs_model_config_version,
  DROP COLUMN model_config_version;
