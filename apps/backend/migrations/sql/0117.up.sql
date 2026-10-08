-- Normalize only known built-in Muse sample names; preserve edited names and user resumes.
UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-blueprint-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '周望舒';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-titleblock-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '周望舒';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-drawinglist-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '周望舒';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-dealbook-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '沈亦舟';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-researchnote-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '沈亦舟';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-workpaper-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '许清和';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-ledger-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '许清和';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-memorandum-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '陈砚秋';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-casebrief-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '陈砚秋';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-datasheet-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '顾行川';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-medicalpapers-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '苏既明';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-clinicalpath-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '苏既明';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-annotations-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '何以宁';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-press-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '江未晚';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-teaching-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '何以宁';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-rundown-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '江未晚';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-revisions-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '顾行川';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-labbook-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '林青蒿';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-element-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '林青蒿';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-playbill-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '温如许';

UPDATE resume_template
SET data_json = JSON_SET(data_json, '$.identity.name.value', '张三')
WHERE BINARY `key` = BINARY 'muse-consulting-cn'
  AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = 'canonical-resume.v1'
  AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.identity.name.value')) = BINARY '罗景行';
