-- Upgrade migration for 0059: add user preferences
CREATE TABLE user_preferences (
  user_id BIGINT UNSIGNED NOT NULL COMMENT '配置所属用户 id',
  preference_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    COMMENT '服务端允许的配置键',
  value_json JSON NOT NULL COMMENT '经过对应接口校验的配置值',
  CONSTRAINT pk_user_preferences PRIMARY KEY (user_id, preference_key),
  CONSTRAINT fk_user_preferences_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT ck_user_preferences_value_object
    CHECK (LOWER(JSON_TYPE(value_json)) = 'object')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='用户账号级产品偏好';
