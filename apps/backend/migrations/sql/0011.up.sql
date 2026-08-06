-- 0011 升级迁移：删除管理员操作审计日志表。
-- 该表仅写入不读取，管理端无查询入口，移除后可简化 schema 并避免禁用/启用用户提交时的无谓写路径。

DROP TABLE IF EXISTS admin_operation_logs;
