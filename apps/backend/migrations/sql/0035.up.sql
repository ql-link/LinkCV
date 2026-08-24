ALTER TABLE llm_capability_bindings
  DROP CHECK ck_llm_capability_bindings_capability,
  ADD CONSTRAINT ck_llm_capability_bindings_capability
    CHECK (capability IN ('chat', 'resume_structuring', 'pi_agent', 'job_image_structuring'));

ALTER TABLE llm_model_validations
  DROP CHECK ck_llm_model_validations_capability,
  ADD CONSTRAINT ck_llm_model_validations_capability
    CHECK (capability IN ('chat', 'resume_structuring', 'pi_agent', 'job_image_structuring'));

INSERT INTO llm_capability_bindings
  (capability, model_config_id, binding_version, validation_id, created_at, updated_at)
SELECT 'job_image_structuring', NULL, 1, NULL, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM llm_capability_bindings WHERE capability = 'job_image_structuring'
);
