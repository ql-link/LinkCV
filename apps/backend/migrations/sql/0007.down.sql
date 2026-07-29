-- 0007 降级迁移：移除用户私有 JD 单表。
-- 此操作会永久删除全部 JD，仅允许在受控环境中执行。
DROP TABLE job_descriptions;
