-- Upgrade migration for 0106: add_interview_prep_items
-- Prep checklist lives on the session row: it is read and written as a whole and never queried across sessions.
ALTER TABLE interview_sessions
  ADD COLUMN prep_items JSON NULL COMMENT '面试准备清单，数组元素 {id,title,category,reason,done}，最多 12 条',
  ADD COLUMN prep_generated_at DATETIME(6) NULL COMMENT 'AI 生成准备清单的时间 UTC；非空表示本场已用掉唯一一次生成';
