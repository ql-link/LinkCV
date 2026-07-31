-- 0009 升级迁移：创建管理员操作审计日志表。
-- 记录管理员禁用或启用用户的操作。
-- 同时收敛已应用过渡版 0008 的本地环境中模型配置表注释漂移。

ALTER TABLE llm_model_configs
  COMMENT='系统模型能力的候选连接配置（含发布兼容列）';

CREATE TABLE admin_operation_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '操作日志自增主键',
  actor_user_id BIGINT UNSIGNED NOT NULL COMMENT '操作人用户 ID',
  target_user_id BIGINT UNSIGNED NOT NULL COMMENT '被操作目标用户 ID',
  action VARCHAR(32) NOT NULL COMMENT '操作类型：disable 或 enable',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '操作时间（UTC）',
  CONSTRAINT pk_admin_operation_logs PRIMARY KEY (id),
  CONSTRAINT fk_admin_op_logs_actor FOREIGN KEY (actor_user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_op_logs_target FOREIGN KEY (target_user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT ck_admin_op_logs_action CHECK (action IN ('disable', 'enable'))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='管理员操作审计日志';
