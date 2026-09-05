-- Upgrade migration for 0056: separate application lifecycle, stage history,
-- and interview schedules while preserving legacy fields for one release.

ALTER TABLE job_applications
  ADD COLUMN lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'active'
    COMMENT 'active 或 terminated' AFTER status,
  ADD COLUMN terminated_at DATETIME(6) NULL
    COMMENT '流程终止时间 UTC' AFTER lifecycle_status,
  ADD COLUMN termination_reason VARCHAR(32) NULL
    COMMENT 'company_rejected、user_withdrew、offer_declined、completed 或 other' AFTER terminated_at;

UPDATE job_applications
SET applied_at = created_at,
    updated_at = updated_at
WHERE applied_at IS NULL
  AND NOT (
    status = 'active'
    AND current_stage_type = 'screening'
    AND TRIM(current_stage_label) = '待投递'
    AND stage_state = 'awaiting_schedule'
  );

UPDATE job_applications
SET lifecycle_status = CASE
      WHEN status = 'active' OR (status = 'closed' AND offer_status = 'accepted')
        THEN 'active'
      ELSE 'terminated'
    END,
    terminated_at = CASE
      WHEN status = 'active' OR (status = 'closed' AND offer_status = 'accepted')
        THEN NULL
      ELSE updated_at
    END,
    termination_reason = CASE
      WHEN status = 'rejected' THEN 'company_rejected'
      WHEN status = 'withdrawn' THEN 'user_withdrew'
      WHEN status = 'closed' AND offer_status = 'declined' THEN 'offer_declined'
      WHEN status = 'closed' AND offer_status <> 'accepted' THEN 'completed'
      ELSE NULL
    END,
    updated_at = updated_at;

ALTER TABLE job_applications
  ADD CONSTRAINT ck_job_applications_lifecycle_status
    CHECK (lifecycle_status IN ('active', 'terminated')),
  ADD CONSTRAINT ck_job_applications_termination_context
    CHECK (
      (lifecycle_status = 'active' AND terminated_at IS NULL AND termination_reason IS NULL)
      OR
      (lifecycle_status = 'terminated' AND terminated_at IS NOT NULL AND termination_reason IS NOT NULL)
    ),
  ADD INDEX idx_job_applications_user_lifecycle_updated
    (user_id, archived_at, lifecycle_status, applied_at, updated_at DESC, id DESC);

CREATE TABLE job_application_stages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '求职阶段自增主键',
  application_id BIGINT UNSIGNED NOT NULL COMMENT '所属求职记录',
  client_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '阶段写入幂等请求 UUID',
  stage_type VARCHAR(24) NOT NULL COMMENT 'screening、assessment、written_test、ai_interview、interview 或 offer',
  stage_label VARCHAR(100) NOT NULL COMMENT '用户可见阶段名称',
  interview_round_no SMALLINT UNSIGNED NULL COMMENT '用户设置的普通面试轮次',
  sequence_no SMALLINT UNSIGNED NOT NULL COMMENT '同一求职记录内阶段顺序',
  stage_status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active、completed 或 cancelled',
  stage_result VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending、passed、rejected 或 skipped',
  current_marker TINYINT UNSIGNED NULL COMMENT '当前阶段为 1，历史阶段为空',
  entered_at DATETIME(6) NOT NULL COMMENT '进入阶段时间 UTC',
  completed_at DATETIME(6) NULL COMMENT '完成阶段时间 UTC',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最后更新时间 UTC',
  CONSTRAINT pk_job_application_stages PRIMARY KEY (id),
  CONSTRAINT fk_job_application_stages_application FOREIGN KEY (application_id) REFERENCES job_applications (id) ON DELETE CASCADE,
  CONSTRAINT uk_job_application_stages_request UNIQUE (application_id, client_request_id),
  CONSTRAINT uk_job_application_stages_sequence UNIQUE (application_id, sequence_no),
  CONSTRAINT uk_job_application_stages_current UNIQUE (application_id, current_marker),
  CONSTRAINT ck_job_application_stages_type CHECK (stage_type IN ('screening', 'assessment', 'written_test', 'ai_interview', 'interview', 'offer')),
  CONSTRAINT ck_job_application_stages_round_context CHECK (
    LENGTH(TRIM(stage_label)) > 0
    AND ((stage_type = 'interview' AND (interview_round_no IS NULL OR interview_round_no >= 1))
      OR (stage_type <> 'interview' AND interview_round_no IS NULL))
  ),
  CONSTRAINT ck_job_application_stages_status CHECK (stage_status IN ('active', 'completed', 'cancelled')),
  CONSTRAINT ck_job_application_stages_result CHECK (stage_result IN ('pending', 'passed', 'rejected', 'skipped')),
  CONSTRAINT ck_job_application_stages_current_context CHECK (
    (current_marker = 1 AND stage_status = 'active' AND completed_at IS NULL)
    OR current_marker IS NULL
  ),
  CONSTRAINT ck_job_application_stages_completed_context CHECK (
    (stage_status = 'completed' AND completed_at IS NOT NULL)
    OR stage_status <> 'completed'
  ),
  INDEX idx_job_application_stages_application_order (application_id, sequence_no, id),
  INDEX idx_job_application_stages_application_status (application_id, stage_status, entered_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='一次求职记录的阶段历史';

INSERT INTO job_application_stages (
  application_id,
  client_request_id,
  stage_type,
  stage_label,
  interview_round_no,
  sequence_no,
  stage_status,
  stage_result,
  current_marker,
  entered_at,
  completed_at,
  created_at,
  updated_at
)
SELECT
  application.id,
  LOWER(UUID()),
  CASE
    WHEN application.current_stage_type = 'offer' THEN 'offer'
    WHEN application.current_stage_type IN ('interview', 'hr') THEN 'interview'
    WHEN LOWER(application.current_stage_label) LIKE '%ai%面试%' THEN 'ai_interview'
    WHEN application.current_stage_label LIKE '%笔试%' THEN 'written_test'
    WHEN application.current_stage_label LIKE '%测评%'
      OR LOWER(application.current_stage_label) LIKE '%assessment%' THEN 'assessment'
    ELSE 'screening'
  END,
  application.current_stage_label,
  CASE WHEN application.current_stage_type = 'interview' THEN application.current_round_no ELSE NULL END,
  65535,
  CASE WHEN application.lifecycle_status = 'active' THEN 'active' ELSE 'completed' END,
  CASE
    WHEN application.status = 'rejected' THEN 'rejected'
    WHEN application.lifecycle_status = 'terminated' THEN 'skipped'
    ELSE 'pending'
  END,
  CASE WHEN application.lifecycle_status = 'active' THEN 1 ELSE NULL END,
  COALESCE(application.applied_at, application.created_at),
  CASE WHEN application.lifecycle_status = 'terminated' THEN application.terminated_at ELSE NULL END,
  application.created_at,
  application.updated_at
FROM job_applications AS application
WHERE application.applied_at IS NOT NULL;

INSERT INTO job_application_stages (
  application_id,
  client_request_id,
  stage_type,
  stage_label,
  interview_round_no,
  sequence_no,
  stage_status,
  stage_result,
  current_marker,
  entered_at,
  completed_at,
  created_at,
  updated_at
)
WITH grouped_sessions AS (
  SELECT
    session.application_id,
    CASE
      WHEN session.stage_type IN ('interview', 'hr') THEN 'interview'
      WHEN session.stage_type = 'offer' THEN 'offer'
      WHEN LOWER(session.stage_label) LIKE '%ai%面试%' THEN 'ai_interview'
      WHEN session.stage_label LIKE '%笔试%' THEN 'written_test'
      WHEN session.stage_label LIKE '%测评%'
        OR LOWER(session.stage_label) LIKE '%assessment%' THEN 'assessment'
      ELSE 'assessment'
    END AS stable_stage_type,
    session.stage_label,
    CASE WHEN session.stage_type = 'interview' THEN session.round_no ELSE NULL END AS stable_round_no,
    MIN(session.created_at) AS first_created_at,
    MAX(COALESCE(session.completed_at, session.cancelled_at, session.updated_at)) AS last_updated_at
  FROM interview_sessions AS session
  GROUP BY
    session.application_id,
    stable_stage_type,
    session.stage_label,
    stable_round_no
),
numbered_sessions AS (
  SELECT
    grouped_sessions.*,
    ROW_NUMBER() OVER (
      PARTITION BY grouped_sessions.application_id
      ORDER BY grouped_sessions.first_created_at, grouped_sessions.stage_label
    ) AS sequence_no
  FROM grouped_sessions
  WHERE NOT EXISTS (
    SELECT 1
    FROM job_application_stages AS current_stage
    WHERE current_stage.application_id = grouped_sessions.application_id
      AND current_stage.sequence_no = 65535
      AND current_stage.stage_type = grouped_sessions.stable_stage_type
      AND current_stage.stage_label = grouped_sessions.stage_label
      AND (current_stage.interview_round_no <=> grouped_sessions.stable_round_no)
  )
)
SELECT
  numbered_sessions.application_id,
  LOWER(UUID()),
  numbered_sessions.stable_stage_type,
  numbered_sessions.stage_label,
  numbered_sessions.stable_round_no,
  numbered_sessions.sequence_no,
  'completed',
  'pending',
  NULL,
  numbered_sessions.first_created_at,
  numbered_sessions.last_updated_at,
  numbered_sessions.first_created_at,
  numbered_sessions.last_updated_at
FROM numbered_sessions;

UPDATE job_application_stages AS source_stage
JOIN (
  SELECT
    application_id,
    COALESCE(MAX(CASE WHEN sequence_no < 65535 THEN sequence_no END), 0) + 1 AS final_sequence_no
  FROM job_application_stages
  GROUP BY application_id
) AS stage_order
  ON stage_order.application_id = source_stage.application_id
SET source_stage.sequence_no = stage_order.final_sequence_no,
    source_stage.updated_at = source_stage.updated_at
WHERE source_stage.sequence_no = 65535;

ALTER TABLE interview_sessions
  ADD COLUMN application_stage_id BIGINT UNSIGNED NULL
    COMMENT '所属求职阶段' AFTER application_id;

UPDATE interview_sessions AS session
SET session.application_stage_id = (
      SELECT stage.id
      FROM job_application_stages AS stage
      WHERE stage.application_id = session.application_id
        AND stage.stage_label = session.stage_label
        AND (
          (stage.stage_type = 'interview' AND session.stage_type IN ('interview', 'hr'))
          OR (stage.stage_type = 'offer' AND session.stage_type = 'offer')
          OR (stage.stage_type IN ('assessment', 'written_test', 'ai_interview') AND session.stage_type = 'other')
        )
        AND (
          stage.stage_type <> 'interview'
          OR stage.interview_round_no <=> CASE WHEN session.stage_type = 'interview' THEN session.round_no ELSE NULL END
        )
      ORDER BY stage.current_marker DESC, stage.sequence_no DESC, stage.id DESC
      LIMIT 1
    ),
    session.updated_at = session.updated_at;

ALTER TABLE interview_sessions
  ADD CONSTRAINT fk_interview_sessions_application_stage
    FOREIGN KEY (application_stage_id) REFERENCES job_application_stages (id) ON DELETE RESTRICT,
  ADD INDEX idx_interview_sessions_stage_time (application_stage_id, start_at, end_at, id),
  ADD INDEX idx_interview_sessions_stage_status (application_stage_id, status, start_at, id);
