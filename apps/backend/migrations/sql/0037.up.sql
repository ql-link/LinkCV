-- Upgrade migration for 0037: sync official template snapshots.
-- The paired revision performs bounded JSON conversion and Pydantic validation
-- after a complete read-only preflight; no physical schema change is required.
SELECT 1;
