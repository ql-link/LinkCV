-- Upgrade migration for 0109: add_application_channel_and_oc_stage
-- Channel and verbal-offer (OC) details belong to one application and are only read with it.
ALTER TABLE job_applications
  ADD COLUMN applied_channel VARCHAR(100) NULL COMMENT '投递渠道，例如同事内推、官网、招聘平台',
  ADD COLUMN oc_communicated_at DATETIME(6) NULL COMMENT 'OC 口头意向沟通时间 UTC',
  ADD COLUMN oc_contact VARCHAR(100) NULL COMMENT 'OC 沟通方式与联系人',
  ADD COLUMN oc_salary_text VARCHAR(100) NULL COMMENT 'OC 口头薪酬原文，以书面 Offer 为准',
  ADD COLUMN oc_start_text VARCHAR(100) NULL COMMENT 'OC 口头约定的到岗时间原文',
  ADD COLUMN oc_note VARCHAR(500) NULL COMMENT 'OC 补充说明';

-- HR 面 and OC become stage types of their own; existing rows keep their recorded type.
ALTER TABLE job_application_stages
  DROP CHECK ck_job_application_stages_type;

ALTER TABLE job_application_stages
  ADD CONSTRAINT ck_job_application_stages_type CHECK (
    stage_type IN ('screening', 'assessment', 'written_test', 'ai_interview', 'interview', 'hr', 'oc', 'offer')
  );
