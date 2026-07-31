-- 0009 降级迁移：删除管理员操作审计日志表。
DROP TABLE IF EXISTS admin_operation_logs;
