-- Refuse incompatible data instead of deleting records in shared environments.
-- Local disposable legacy records must be cleaned explicitly before upgrading.
ALTER TABLE job_descriptions
  DROP CHECK ck_job_descriptions_employment_type,
  ADD CONSTRAINT ck_job_descriptions_employment_type
    CHECK (employment_type IS NULL OR employment_type IN ('internship', 'campus', 'full_time'));
