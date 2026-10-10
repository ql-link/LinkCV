-- Upgrade migration for 0118: add_user_profile_application_data
ALTER TABLE user_profile
    ADD COLUMN application_data JSON NULL COMMENT '用户确认的网申事实与简历对应关系，版本化对象，应用限制64KiB',
    ADD CONSTRAINT ck_user_profile_application_data_object CHECK (application_data IS NULL OR LOWER(JSON_TYPE(application_data)) = 'object');
