-- Upgrade migration for 0063: support independent resume translation proposals
ALTER TABLE resume_change_proposals
  DROP CHECK ck_resume_change_proposals_mode,
  ADD COLUMN proposed_title VARCHAR(255) NULL
    COMMENT '翻译结果的新简历标题' AFTER source_refs_json,
  ADD COLUMN result_resume_id BIGINT UNSIGNED NULL
    COMMENT '翻译确认后创建的简历标识' AFTER proposed_title,
  ADD CONSTRAINT ck_resume_change_proposals_mode CHECK (
    proposal_mode IN (
      'legacy_snapshot',
      'polish_local',
      'rewrite_entry_star',
      'generate_from_materials',
      'translate_resume'
    )
  ),
  ADD CONSTRAINT ck_resume_change_proposals_translation_result CHECK (
    (proposal_mode = 'translate_resume' AND (
      (status = 'applied' AND result_resume_id IS NOT NULL) OR
      (status <> 'applied' AND result_resume_id IS NULL)
    )) OR (
      proposal_mode <> 'translate_resume' AND
      proposed_title IS NULL AND
      result_resume_id IS NULL
    )
  );
