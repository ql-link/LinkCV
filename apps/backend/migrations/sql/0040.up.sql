-- Upgrade migration for 0040: repair official template manifests.
-- The paired revision performs a bounded JSON conversion and validates every
-- affected ResumeSnapshot before the first write; no schema change is needed.
SELECT 1;
