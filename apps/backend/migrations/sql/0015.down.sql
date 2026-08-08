-- Down migration for 0015: create resume imports
-- The Python revision refuses downgrade while records still exist.

DROP TABLE resume_imports;
