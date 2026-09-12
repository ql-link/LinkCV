-- Upgrade migration for 0041: remove template projection from resume content.
-- The paired revision performs a bounded JSON conversion with complete
-- preflight and post-write ResumeSnapshot validation; no schema change is
-- needed.
SELECT 1;
