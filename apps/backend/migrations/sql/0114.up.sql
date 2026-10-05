-- 0114: every table gets an id primary key plus creation and update times (Alibaba MySQL rule).
-- Tables keyed by other columns keep that key as a unique index, so uniqueness is unchanged.
-- Their foreign keys were dropped in 0113, so the old primary keys can be replaced here.
-- Backfills are idempotent and assign updated_at explicitly so ON UPDATE never rewrites it.

ALTER TABLE `account_preferences`
	DROP PRIMARY KEY,
	ADD COLUMN `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键' FIRST,
	ADD PRIMARY KEY (`id`),
	ADD UNIQUE KEY `uk_account_preferences_user_id` (`user_id`);

ALTER TABLE `announcement_read_cursors`
	DROP PRIMARY KEY,
	ADD COLUMN `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键' FIRST,
	ADD PRIMARY KEY (`id`),
	ADD UNIQUE KEY `uk_announcement_read_cursors_user_id` (`user_id`),
	ADD COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）' AFTER `read_through_at`;

UPDATE `announcement_read_cursors`
SET `created_at` = `updated_at`, `updated_at` = `updated_at`;

ALTER TABLE `job_application_offer_materials`
	DROP PRIMARY KEY,
	ADD COLUMN `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键' FIRST,
	ADD PRIMARY KEY (`id`),
	ADD UNIQUE KEY `uk_job_application_offer_materials_application_dataset` (`application_id`, `dataset_id`),
	ADD COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）；0114 之前的关联取迁移执行时间',
	ADD COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）';

ALTER TABLE `llm_use_case_routes`
	DROP PRIMARY KEY,
	ADD COLUMN `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键' FIRST,
	ADD PRIMARY KEY (`id`),
	ADD UNIQUE KEY `uk_llm_use_case_routes_use_case_route` (`use_case`, `route_id`),
	ADD COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）' AFTER `validated_at`;

UPDATE `llm_use_case_routes`
SET `created_at` = `updated_at`, `updated_at` = `updated_at`;

ALTER TABLE `agent_stage_events`
	ADD COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（UTC）',
	ADD COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）';

UPDATE `agent_stage_events`
SET `created_at` = `occurred_at`, `updated_at` = `occurred_at`;

ALTER TABLE `agent_operations`
	ADD COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）' AFTER `created_at`;

UPDATE `agent_operations` SET `updated_at` = `created_at`;

ALTER TABLE `agent_messages`
	ADD COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）' AFTER `created_at`;

UPDATE `agent_messages` SET `updated_at` = `created_at`;

ALTER TABLE `llm_call_logs`
	ADD COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）' AFTER `created_at`;

UPDATE `llm_call_logs` SET `updated_at` = `created_at`;

ALTER TABLE `user_dataset`
	ADD COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）' AFTER `created_at`;

UPDATE `user_dataset` SET `updated_at` = `created_at`;

ALTER TABLE `product_events`
	ADD COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '更新时间（UTC）' AFTER `created_at`;

UPDATE `product_events` SET `updated_at` = `created_at`;
