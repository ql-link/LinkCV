-- Down migration for 0032: remove empty interview center schema.
-- Do not run after real interview assets have been stored without first exporting data.
-- The Python revision refuses downgrade while any interview center record exists.

DROP TABLE interview_assets;
DROP TABLE interview_sessions;
DROP TABLE job_applications;
