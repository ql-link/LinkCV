-- Down migration for 0023: removes all Agent history and pending proposals.
-- Stop the Pi service and confirm no Agent records require retention first.

DROP TABLE IF EXISTS resume_change_proposals;
DROP TABLE IF EXISTS agent_tool_calls;
DROP TABLE IF EXISTS agent_messages;
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS agent_sessions;

UPDATE resume_versions SET reason = 'manual' WHERE reason = 'agent';

ALTER TABLE resume_versions
  DROP CHECK ck_resume_versions_reason,
  ADD CONSTRAINT ck_resume_versions_reason
    CHECK (reason IN ('initial', 'manual', 'before_restore', 'restore'));
