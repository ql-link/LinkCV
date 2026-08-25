-- Upgrade migration for 0039: normalize official template block ids.
-- The paired revision performs a bounded JSON conversion and validates all
-- official ResumeSnapshots before the first write; no schema change is needed.
SELECT 1;
