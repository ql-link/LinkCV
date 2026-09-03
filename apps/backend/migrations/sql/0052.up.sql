-- Upgrade migration for 0052: simplify Offer status and details.
-- All detail columns are nullable so entering the Offer stage never requires
-- compensation or benefits disclosure. Legacy OC and written Offer values are
-- intentionally merged into the single received state.
ALTER TABLE job_applications
  ADD COLUMN offer_base_location VARCHAR(100) NULL
    COMMENT 'Offer 工作地点' AFTER offer_status,
  ADD COLUMN offer_salary_min DECIMAL(12, 2) NULL
    COMMENT 'Offer 薪资下限' AFTER offer_base_location,
  ADD COLUMN offer_salary_max DECIMAL(12, 2) NULL
    COMMENT 'Offer 薪资上限' AFTER offer_salary_min,
  ADD COLUMN offer_salary_currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT 'Offer 薪资币种 ISO 4217' AFTER offer_salary_max,
  ADD COLUMN offer_salary_period VARCHAR(16) NULL
    COMMENT 'Offer 计薪周期' AFTER offer_salary_currency,
  ADD COLUMN offer_benefits_description VARCHAR(500) NULL
    COMMENT 'Offer 福利待遇' AFTER offer_salary_period,
  DROP CHECK ck_job_applications_offer_status,
  ADD CONSTRAINT ck_job_applications_offer_salary_period
    CHECK (
      offer_salary_period IS NULL
      OR offer_salary_period IN ('hour', 'day', 'month', 'year')
    ),
  ADD CONSTRAINT ck_job_applications_offer_salary_range
    CHECK (
      offer_salary_min IS NULL
      OR offer_salary_max IS NULL
      OR offer_salary_max >= offer_salary_min
    ),
  ADD CONSTRAINT ck_job_applications_offer_salary_context
    CHECK (
      (offer_salary_min IS NULL AND offer_salary_max IS NULL)
      OR (offer_salary_currency IS NOT NULL AND offer_salary_period IS NOT NULL)
    ),
  ADD CONSTRAINT ck_job_applications_offer_salary_currency
    CHECK (
      offer_salary_currency IS NULL
      OR LENGTH(offer_salary_currency) = 3
    );

UPDATE job_applications
SET offer_status = 'received',
    updated_at = updated_at
WHERE offer_status IN ('oc_received', 'written_offer_received');

ALTER TABLE job_applications
  ADD CONSTRAINT ck_job_applications_offer_status
    CHECK (offer_status IN ('none', 'received', 'accepted', 'declined'));
