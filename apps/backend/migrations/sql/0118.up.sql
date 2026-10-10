-- 0118: 资料库「我的项目」增加项目说明。增量字段，存量文件夹为空字符串。

ALTER TABLE user_dataset_folder
    ADD COLUMN description VARCHAR(500) NOT NULL DEFAULT '' COMMENT '项目说明' AFTER name;
