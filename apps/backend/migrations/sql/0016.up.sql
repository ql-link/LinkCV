-- Legacy source objects and imported resumes must be removed by the release
-- cleanup command before this migration is applied.
ALTER TABLE resumes
    DROP CHECK ck_resumes_source_fields,
    DROP COLUMN source_filename,
    DROP COLUMN source_object_key,
    DROP COLUMN extracted_markdown;
