-- Upgrade migration for 0062: repair the historical 0059 split and add the logo fingerprint.
-- The paired Python revision accepts only the known complete Development or
-- Production shapes before this conditional additive repair runs.
SET @linkresume_0062_add_logo_url = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'job_descriptions'
      AND column_name = 'logo_url'
  ),
  'SELECT 1',
  'ALTER TABLE job_descriptions ADD COLUMN logo_url VARCHAR(2048) NULL COMMENT ''用户为该岗位保存的公司 Logo HTTPS URL'' AFTER company_name'
);

PREPARE linkresume_0062_statement FROM @linkresume_0062_add_logo_url;
EXECUTE linkresume_0062_statement;
DEALLOCATE PREPARE linkresume_0062_statement;

CREATE TABLE IF NOT EXISTS global_companies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '全局公司资料主键',
  company_name VARCHAR(200) NOT NULL COMMENT '公司展示名称',
  normalized_name VARCHAR(200) NOT NULL COMMENT '用于维护去重的标准化名称',
  legal_name VARCHAR(255) NULL COMMENT '公司工商全称',
  logo_url VARCHAR(2048) NULL COMMENT '公司 Logo HTTPS URL',
  website_url VARCHAR(2048) NULL COMMENT '公司官网 HTTPS URL',
  industry VARCHAR(100) NULL COMMENT '行业',
  company_size VARCHAR(50) NULL COMMENT '公司规模',
  financing_stage VARCHAR(50) NULL COMMENT '融资阶段',
  description LONGTEXT NULL COMMENT '公司简介',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间 UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间 UTC',
  CONSTRAINT pk_global_companies PRIMARY KEY (id),
  CONSTRAINT uk_global_companies_normalized_name UNIQUE (normalized_name),
  CONSTRAINT ck_global_companies_company_name_not_blank CHECK (LENGTH(TRIM(company_name)) > 0),
  CONSTRAINT ck_global_companies_normalized_name_not_blank CHECK (LENGTH(TRIM(normalized_name)) > 0)
) COMMENT='平台独立维护的全局公司资料';

ALTER TABLE job_descriptions
  ADD COLUMN logo_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT '托管公司图片最终字节的 SHA-256' AFTER logo_url;

SET @linkresume_0062_add_logo_url = NULL;
