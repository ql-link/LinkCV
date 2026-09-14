-- Upgrade migration for 0058: add interview answer plans
ALTER TABLE interview_sessions
  ADD COLUMN schedule_kind VARCHAR(24) NOT NULL DEFAULT 'fixed_slot'
    COMMENT 'fixed_slot 固定场次或 open_window 开放窗口' AFTER end_at,
  ADD COLUMN answer_plan_start_at DATETIME(6) NULL
    COMMENT '用户个人作答计划开始时间 UTC' AFTER schedule_kind,
  ADD COLUMN answer_plan_end_at DATETIME(6) NULL
    COMMENT '用户个人作答计划结束时间 UTC' AFTER answer_plan_start_at,
  ADD CONSTRAINT ck_interview_sessions_schedule_kind
    CHECK (schedule_kind IN ('fixed_slot', 'open_window')),
  ADD CONSTRAINT ck_interview_sessions_answer_plan
    CHECK (
      (schedule_kind = 'fixed_slot'
        AND answer_plan_start_at IS NULL
        AND answer_plan_end_at IS NULL)
      OR
      (schedule_kind = 'open_window' AND (
        (answer_plan_start_at IS NULL AND answer_plan_end_at IS NULL)
        OR
        (answer_plan_start_at IS NOT NULL
          AND answer_plan_end_at IS NOT NULL
          AND answer_plan_end_at > answer_plan_start_at
          AND answer_plan_start_at >= start_at
          AND answer_plan_end_at <= end_at)
      ))
    );
