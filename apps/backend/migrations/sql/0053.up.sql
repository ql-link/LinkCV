-- Upgrade migration for 0053: replace the Offer salary range with one value.
-- Preserve the existing lower value. If only the upper value exists, move it
-- into the retained column before removing the obsolete range column.
ALTER TABLE job_applications
  DROP CHECK ck_job_applications_offer_salary_range,
  DROP CHECK ck_job_applications_offer_salary_context;

UPDATE job_applications
SET offer_salary_min = COALESCE(offer_salary_min, offer_salary_max),
    updated_at = updated_at
WHERE offer_salary_min IS NULL
  AND offer_salary_max IS NOT NULL;

ALTER TABLE job_applications
  DROP COLUMN offer_salary_max,
  CHANGE COLUMN offer_salary_min offer_salary DECIMAL(12, 2) NULL
    COMMENT 'Offer 薪资' AFTER offer_base_location,
  ADD CONSTRAINT ck_job_applications_offer_salary_context
    CHECK (
      offer_salary IS NULL
      OR (offer_salary_currency IS NOT NULL AND offer_salary_period IS NOT NULL)
    );
