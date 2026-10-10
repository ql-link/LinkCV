-- 0118: Persist editor section focus results. Two new empty tables; existing tables are unchanged.

CREATE TABLE resume_section_review (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
	user_id BIGINT UNSIGNED NOT NULL COMMENT '所属用户 ID',
	resume_id BIGINT UNSIGNED NOT NULL COMMENT '所属简历 ID',
	unit_id VARCHAR(64) NOT NULL COMMENT '段落节点 ID（编辑器 node_id）',
	analysis_no INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '第几次分析，重新分析时加一',
	reference_json JSON NOT NULL COMMENT '参照：general 或 method 写作法则',
	job_id BIGINT UNSIGNED NULL COMMENT '参照的目标岗位 ID，无则为空',
	intent VARCHAR(300) NOT NULL DEFAULT '' COMMENT '用户填写的突出方向',
	context_ids_json JSON NOT NULL COMMENT '参考段落 ID 数组，至多 6 个',
	base_lines_json JSON NOT NULL COMMENT '分析时各句原文：line_id 到文本',
	result_json JSON NOT NULL COMMENT '分析结果：参照名、推断方向、是否内容太少、起草问题与批注',
	create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
	update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间 UTC',
	CONSTRAINT pk_resume_section_review PRIMARY KEY (id),
	CONSTRAINT uk_resume_section_review_unit UNIQUE (resume_id, unit_id),
	CONSTRAINT ck_resume_section_review_context_ids CHECK (LOWER(JSON_TYPE(context_ids_json)) = 'array'),
	CONSTRAINT ck_resume_section_review_base_lines CHECK (LOWER(JSON_TYPE(base_lines_json)) = 'object')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='简历段落聚焦的最新一次分析，每段一行';

CREATE INDEX idx_resume_section_review_user ON resume_section_review (user_id);

CREATE TABLE resume_section_review_item (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
	user_id BIGINT UNSIGNED NOT NULL COMMENT '所属用户 ID',
	resume_id BIGINT UNSIGNED NOT NULL COMMENT '所属简历 ID',
	review_id BIGINT UNSIGNED NOT NULL COMMENT '所属段落分析 ID',
	note_id VARCHAR(32) NULL COMMENT '对应分析结果中的批注 ID；自定义要求和起草为空',
	kind VARCHAR(16) NOT NULL COMMENT '类型：missing 缺信息 / wording 表达 / structure 结构 / ask 自定义要求 / draft 起草',
	line_id VARCHAR(64) NULL COMMENT '作用的句子节点 ID，整段批注为空',
	instruction VARCHAR(300) NOT NULL DEFAULT '' COMMENT '用户自定义要求原话',
	status VARCHAR(16) NOT NULL COMMENT '状态：todo 未处理 / asking 追问中 / pending 待确认 / done 已采用 / skipped 已跳过',
	question_index TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前追问序号，从 0 开始',
	answers_json JSON NOT NULL COMMENT '用户回答，按追问顺序的字符串数组，至多 3 个',
	draft_json JSON NULL COMMENT '候选：variants、missing、base_text、line_id',
	selected_index TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '选中的候选序号',
	edit_json JSON NULL COMMENT '已采用改动：line_id、before、after，仅 done 时非空',
	create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
	update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间 UTC',
	CONSTRAINT pk_resume_section_review_item PRIMARY KEY (id),
	CONSTRAINT ck_resume_section_review_item_kind CHECK (kind IN ('missing', 'wording', 'structure', 'ask', 'draft')),
	CONSTRAINT ck_resume_section_review_item_status CHECK (status IN ('todo', 'asking', 'pending', 'done', 'skipped')),
	CONSTRAINT ck_resume_section_review_item_edit CHECK ((status = 'done') = (edit_json IS NOT NULL)),
	CONSTRAINT ck_resume_section_review_item_answers CHECK (LOWER(JSON_TYPE(answers_json)) = 'array')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='简历段落聚焦中的一条批注、自定义要求或起草';

CREATE INDEX idx_resume_section_review_item_resume ON resume_section_review_item (resume_id, review_id, id);
CREATE INDEX idx_resume_section_review_item_user ON resume_section_review_item (user_id);
