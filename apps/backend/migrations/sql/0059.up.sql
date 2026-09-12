-- Upgrade migration for 0059: add company logos
ALTER TABLE job_descriptions
  ADD COLUMN logo_url VARCHAR(2048) NULL
    COMMENT '用户为该岗位保存的公司 Logo HTTPS URL' AFTER company_name;

CREATE TABLE global_companies (
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
