-- Publish the first-pass template classifications. Existing rows not in the draft remain pending.
ALTER TABLE resume_templates
  ADD COLUMN style_categories_json JSON NULL COMMENT '模板视觉风格分类；NULL 表示尚未标注',
  ADD COLUMN use_cases_json JSON NULL COMMENT '模板适用求职场景；NULL 表示尚未标注',
  ADD COLUMN style_review_status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT '风格审核状态：pending、classified、unsure';

UPDATE resume_templates
SET style_categories_json = CAST('["经典"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'classic-technical-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'administrative-sidebar-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["校招","社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'campus-professional-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典","现代"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'civic-service-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'creative-orange-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'right-rail-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'sage-paper-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'blue-ribbon-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'timeline-gutter-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典","现代"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'centered-portrait-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'mist-masthead-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","经典"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-folio-serif-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-mono-ledger-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","经典"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-centered-rule-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-framed-letter-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-corner-bracket-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["实习"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-editorial-banner-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-split-nameplate-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-underline-tabs-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-numbered-sections-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-dotted-journal-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-ruled-notebook-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-minimal-axis-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-slate-sidebar-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-ivory-sidebar-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["实习"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-forest-sidebar-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-portrait-rail-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-boxed-sidebar-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-copper-sidebar-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-narrow-index-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-ink-sidebar-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-sand-sidebar-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-plum-sidebar-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-floating-profile-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典","现代"]' AS JSON),
    use_cases_json = CAST('["实习"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-right-outline-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-teal-sidebar-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["实习"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-right-cards-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-ribbon-profile-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-twin-ledger-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-twin-cards-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-newspaper-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-crossbar-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-split-panel-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-offset-masthead-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-capsule-head-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-diagonal-head-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典","创意"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-arch-portrait-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'atlas-top-bottom-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'studio-modular-cards-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'studio-skill-cards-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'studio-duotone-grid-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'studio-portrait-feature-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'studio-layered-capsule-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'studio-node-timeline-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'open-even-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","经典"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'open-moderncv-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'open-caffeine-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'open-classy-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'open-actual-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'open-class-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'original-vermilion-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'original-balanced-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'original-dossier-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'original-axis-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","经典"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'original-warm-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'original-index-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'original-offset-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'original-marginal-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'original-hanging-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["经典"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'career-kendall-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'career-stack-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'career-spartan-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'career-onepage-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","经典"]' AS JSON),
    use_cases_json = CAST('["实习"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'career-classic-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["校招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'featured-campus-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'featured-professional-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["实习"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'featured-intern-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'featured-sales-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'featured-product-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'featured-finance-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'featured-people-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'featured-card-dashed-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'featured-card-rail-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["简约","经典"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'featured-classic-business-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';

UPDATE resume_templates
SET style_categories_json = CAST('["现代","创意"]' AS JSON),
    use_cases_json = CAST('["社招"]' AS JSON),
    style_review_status = 'classified'
WHERE `key` = 'featured-vitality-cn'
  AND style_categories_json IS NULL AND use_cases_json IS NULL AND style_review_status = 'pending';
