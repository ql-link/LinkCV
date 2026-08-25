-- Upgrade migration for 0036: migrate resume snapshots to canonical model
-- JSON conversion requires application-level Pydantic validation and is
-- performed by the paired revision after a complete read-only preflight.
SELECT 1;
