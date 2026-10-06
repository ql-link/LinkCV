-- Upgrade migration for 0097: add llm model user selectable
-- Existing models default to selectable so the conversation model list is unchanged after upgrade.
ALTER TABLE llm_models
  ADD COLUMN user_selectable TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '对话页是否允许用户选择；隐藏的模型不进入列表、不作默认、不可被会话使用' AFTER developer_name;
