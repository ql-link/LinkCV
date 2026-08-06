-- 0011 降级迁移：重建管理员操作审计日志表。
-- 降级时恢复 0009 定义的完整表结构与约束。

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
