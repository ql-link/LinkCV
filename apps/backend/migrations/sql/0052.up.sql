-- Upgrade migration for 0052: add agent session pinning

ALTER TABLE agent_sessions
  ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT '是否置顶' AFTER title,
  DROP INDEX idx_agent_sessions_user_updated,
  ADD INDEX idx_agent_sessions_user_pinned_updated
    (user_id, pinned, updated_at, id),
  DROP INDEX idx_agent_sessions_resume_updated,
  ADD INDEX idx_agent_sessions_resume_pinned_updated
    (resume_id, pinned, updated_at, id);
