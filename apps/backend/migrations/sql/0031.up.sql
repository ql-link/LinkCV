-- Up migration for 0031: add scoped agent proposals
ALTER TABLE resume_change_proposals
  ADD COLUMN proposal_mode VARCHAR(32) NOT NULL DEFAULT 'legacy_snapshot'
    COMMENT '提案模式：legacy_snapshot、polish_local、rewrite_entry_star、generate_from_materials'
    AFTER summary,
  ADD COLUMN target_locator_json JSON NULL
    COMMENT '稳定目标定位；旧快照提案为空'
    AFTER proposal_mode,
  ADD COLUMN target_content_hash VARCHAR(71) NULL
    COMMENT '目标内容 SHA-256 前置条件，含算法前缀'
    AFTER target_locator_json,
  ADD COLUMN diagnosis_json JSON NULL
    COMMENT '创建范围化提案所依据的结构化诊断'
    AFTER target_content_hash,
  ADD COLUMN operations_json JSON NULL
    COMMENT '后端已验证的类型化修改操作'
    AFTER diagnosis_json,
  ADD COLUMN rationale_json JSON NULL
    COMMENT '面向用户的逐项修改依据；旧提案为空'
    AFTER operations_json,
  ADD COLUMN source_refs_json JSON NULL
    COMMENT '提案引用的职位或资料来源；旧提案为空'
    AFTER rationale_json,
  ADD CONSTRAINT ck_resume_change_proposals_mode CHECK (
    proposal_mode IN (
      'legacy_snapshot',
      'polish_local',
      'rewrite_entry_star',
      'generate_from_materials'
    )
  );
