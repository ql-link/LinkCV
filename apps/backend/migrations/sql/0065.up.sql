-- Upgrade migration for 0065: remove the obsolete persistent resume binding.
-- Convert every legacy session binding into message-level historical context
-- before dropping the column. Existing message contexts remain authoritative.

UPDATE agent_messages AS message
JOIN agent_sessions AS session
  ON session.id = message.session_id
LEFT JOIN resumes AS resume
  ON resume.id = session.resume_id
  AND resume.user_id = session.user_id
SET message.metadata_json = JSON_SET(
  COALESCE(message.metadata_json, JSON_OBJECT()),
  '$.version', 1,
  '$.contexts', JSON_ARRAY(JSON_OBJECT(
    'type', 'resume',
    'id', CAST(session.resume_id AS CHAR),
    'version', COALESCE(CAST(resume.lock_version AS CHAR), 'deleted'),
    'lock_version', resume.lock_version,
    'resume_id', CAST(session.resume_id AS CHAR),
    'label', COALESCE(resume.title, '已删除简历'),
    'description', NULL,
    'updated_at', DATE_FORMAT(
      COALESCE(resume.updated_at, session.updated_at),
      '%Y-%m-%dT%H:%i:%s.%fZ'
    )
  ))
)
WHERE session.resume_id IS NOT NULL
  AND message.role = 'user'
  AND (
    message.metadata_json IS NULL
    OR JSON_EXTRACT(message.metadata_json, '$.contexts') IS NULL
  );

ALTER TABLE agent_sessions
  DROP INDEX idx_agent_sessions_resume_pinned_updated,
  DROP COLUMN resume_id;
