-- 0098: product funnel events (registration, resume created, AI customization applied,
-- mock interview completed, PDF exported). Only ids and enum dimensions, never content.
CREATE TABLE product_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '事件所属用户',
  event_name VARCHAR(32) NOT NULL COMMENT '事件名：user_registered/resume_created/ai_customization_applied/mock_interview_completed/resume_pdf_exported',
  dedupe_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '同一业务对象只记一次的去重键；PDF 导出为空',
  properties_json JSON NULL COMMENT '枚举维度与业务对象编号，不含内容',
  occurred_at DATETIME(6) NOT NULL COMMENT '业务完成时间 UTC（补齐数据取原业务时间）',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '写入时间 UTC',
  CONSTRAINT pk_product_events PRIMARY KEY (id),
  CONSTRAINT uk_product_events_dedupe UNIQUE (dedupe_key),
  CONSTRAINT fk_product_events_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_product_events_name CHECK (event_name IN (
    'user_registered', 'resume_created', 'ai_customization_applied',
    'mock_interview_completed', 'resume_pdf_exported'
  )),
  INDEX idx_product_events_name_time (event_name, occurred_at),
  INDEX idx_product_events_user_name (user_id, event_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='产品漏斗事件，只记录行为是否发生、时间与入口';
