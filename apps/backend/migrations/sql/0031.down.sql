-- Down migration for 0031: add scoped agent proposals
ALTER TABLE resume_change_proposals
  DROP CHECK ck_resume_change_proposals_mode,
  DROP COLUMN source_refs_json,
  DROP COLUMN rationale_json,
  DROP COLUMN operations_json,
  DROP COLUMN diagnosis_json,
  DROP COLUMN target_content_hash,
  DROP COLUMN target_locator_json,
  DROP COLUMN proposal_mode;
