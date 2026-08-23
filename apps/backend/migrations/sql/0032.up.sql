ALTER TABLE agent_messages
  ADD COLUMN message_type VARCHAR(24) NOT NULL DEFAULT 'text' COMMENT '消息类型：text、clarification' AFTER role,
  ADD COLUMN metadata_json JSON NULL COMMENT '版本化结构化消息元数据；普通文本为空' AFTER content,
  ADD CONSTRAINT ck_agent_messages_message_type CHECK (message_type IN ('text', 'clarification'));
