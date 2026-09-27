-- Upgrade migration for 0092: 模型调用目标使用区分大小写的排序规则
-- Upstream model and deployment IDs are case-sensitive. AIHubMix publishes
-- distinct IDs such as DeepSeek-OCR and deepseek-ocr in the same catalog.
ALTER TABLE llm_model_routes
  MODIFY COLUMN invoke_target VARCHAR(256)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  MODIFY COLUMN catalog_model_id VARCHAR(256)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL;
