-- Upgrade migration for 0038: remove official template typed duplicates.
-- The paired revision performs bounded JSON conversion and validates every
-- complete ResumeSnapshot before the first write; no schema change is needed.
SELECT 1;
