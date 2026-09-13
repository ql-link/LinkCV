-- Upgrade migration for 0062: add job company logo fingerprint
ALTER TABLE job_descriptions
  ADD COLUMN logo_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT '托管公司图片最终字节的 SHA-256' AFTER logo_url;
