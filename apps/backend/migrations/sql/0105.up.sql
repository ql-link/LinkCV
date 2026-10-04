ALTER TABLE job_applications
    ADD COLUMN offer_received_on DATE NULL COMMENT '正式 Offer 收到日期',
    ADD COLUMN offer_reply_due_on DATE NULL COMMENT '正式 Offer 回复截止日期',
    ADD COLUMN offer_start_on DATE NULL COMMENT '预计入职日期',
    ADD COLUMN offer_probation VARCHAR(100) NULL COMMENT '试用期说明';

CREATE TABLE job_application_offer_materials (
    application_id BIGINT UNSIGNED NOT NULL COMMENT '求职进程',
    dataset_id BIGINT UNSIGNED NOT NULL COMMENT '本人资料库文件',
    CONSTRAINT pk_application_offer_materials PRIMARY KEY (application_id, dataset_id),
    CONSTRAINT fk_offer_material_application FOREIGN KEY (application_id)
        REFERENCES job_applications (id) ON DELETE CASCADE,
    CONSTRAINT fk_offer_material_dataset FOREIGN KEY (dataset_id)
        REFERENCES user_dataset (id) ON DELETE CASCADE,
    INDEX idx_application_offer_materials_dataset (dataset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='正式 Offer 与资料库文件的关联';

ALTER TABLE interview_sessions
    ADD COLUMN review_report JSON NULL COMMENT '基于文字记录生成的结构化复盘',
    ADD COLUMN review_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '最近复盘请求幂等键',
    ADD COLUMN review_started_at DATETIME(6) NULL COMMENT '最近复盘生成开始时间',
    ADD COLUMN review_status VARCHAR(16) NULL COMMENT 'generating/ready/failed',
    ADD COLUMN review_error VARCHAR(64) NULL COMMENT '安全失败码';
