-- Upgrade migration for 0055: allow manually created job descriptions to be empty.
ALTER TABLE job_descriptions
  DROP CHECK ck_job_descriptions_description_not_blank;
