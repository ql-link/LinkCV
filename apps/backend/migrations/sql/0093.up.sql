-- Historical 0088 added these tables before that application layer was reverted.
-- The revision preflight requires both tables to be empty before removing them.
-- IF EXISTS permits retry after a partial MySQL DDL commit.
DROP TABLE IF EXISTS llm_provider_models;
DROP TABLE IF EXISTS llm_providers;
