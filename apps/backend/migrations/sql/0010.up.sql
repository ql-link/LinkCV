-- Up migration for 0010: drop storage cleanup jobs
-- Python revision 会先拒绝删除仍包含待处理任务的表，避免静默遗留对象。
DROP TABLE storage_cleanup_jobs;
