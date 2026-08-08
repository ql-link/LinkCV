ALTER TABLE resumes
    ADD COLUMN source_filename VARCHAR(255) NULL COMMENT '导入文件原名' AFTER source_type,
    ADD COLUMN source_object_key VARCHAR(512) NULL COMMENT '私有导入原文件对象键' AFTER source_filename,
    ADD COLUMN extracted_markdown LONGTEXT NULL COMMENT '导入解析的中间文本证据' AFTER source_object_key,
    ADD CONSTRAINT ck_resumes_source_fields CHECK (
        (source_type = 'blank'
            AND source_filename IS NULL
            AND source_object_key IS NULL
            AND extracted_markdown IS NULL)
        OR (source_type = 'template'
            AND source_filename IS NULL
            AND source_object_key IS NULL
            AND extracted_markdown IS NULL)
        OR (source_type = 'import'
            AND source_filename IS NOT NULL
            AND source_object_key IS NOT NULL
            AND extracted_markdown IS NOT NULL)
    );
