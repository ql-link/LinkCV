// 站点配置：三级选择器（经历容器、模块标题、字段标签）与下拉浮层选择器。
// 写入层只用到 option_* 和 delay_fill_selector；三级选择器留给字段抽取使用。

export const SITE_CONFIGS = {
  'hotjob.cn': { group_class: '[class~="form-cell-inner"]', level1_class: '.tit', level2_class: '.ant-form-item-label' },
  'zhaopin.com': {
    group_class: '[class~="apply-form"]',
    level1_class: '.form-content--title',
    level2_class: '.el-form-item__label',
    delay_fill_selector: '[data-af-label="证件号码类型"]',
  },
  'bytedance.com': {
    group_class: '[class^="apply-form-array-card__"]',
    level1_class: '.applyFormModuleWrapper-title',
    level2_class: '.ud-formily-item-label-content',
    option_container_selector: "[class*='dropdown']",
    option_selector: "[class*='option'], [class*='item']",
  },
  'feishu.cn': {
    group_class: '[class^="apply-form-array-card__"]',
    level1_class: '.applyFormModuleWrapper-title, .createFormSection-title',
    level2_class: '.ud-formily-item-label-content',
    option_container_selector: "[class*='dropdown']",
    option_selector: "[class*='option'], [class*='item']",
  },
  'kuaishou.cn': { group_class: '.edit-resume-form-item-container', level1_class: '.section-gorgeously-title', level2_class: '.ant-form-item-label' },
  'midea.com': {
    group_class: '.multiple-block',
    level1_class: '.css-ielwhl',
    level2_class: '.ant-form-item-label',
    option_container_selector: '.ant-dropdown',
    option_selector: '.ant-menu-item',
  },
  'bilibili.com': { group_class: '.bili-form-multiple', level1_class: '.bili-form-card-header', level2_class: '.ant-form-item-label' },
  'join.qq.com': { group_class: 'info_list', level1_class: '.send_title', level2_class: '.subtitle' },
  'jd.com': { group_class: 'div[class*=contentItem] > div', level1_class: 'div[class*=titleContainer] > span', level2_class: 'div[class*=filedName]' },
  'pddglobalhr.com': { group_class: '', level1_class: "[class^='divider-title_title']", level2_class: '.ant-form-item-label, .rocket-form-field-item-label' },
  'iflytek.com': { group_class: '', level1_class: '.desc p', level2_class: '.el-form-item__label' },
  'zhaopin.meituan.com': {
    group_class: '.model_list',
    level1_class: '.model_title',
    level2_class: '.mtd-form-item-body .label',
    option_container_selector: '.mtd-select-popup',
    option_selector: '.mtd-select-item',
  },
  'we.dji.com': { group_class: "[class^='ResumeEditForm_formlist_item']", level1_class: "[class^='ResumeEditGroup_group_title']", level2_class: '.ant-form-item-label' },
  'campus.163.com': { group_class: '.ant-row u-wraps', level1_class: '.ant-card-head-title', level2_class: '.ant-form-item-label' },
  'zuru.gllue.com': {
    group_class: '.reverse-fk-item',
    level1_class: '.slds-section__title, .container-title',
    level2_class: '.field-label',
    option_container_selector: '.slds-select',
    option_selector: 'option',
  },
  'mhr.ly.com': { group_class: '.el-form section', level1_class: '.block-wrap .title', level2_class: '.el-form-item__label' },
  'antgroup.com': { group_class: "[class*='formCard_'], [class*='formDynamicItem']", level1_class: "[class*='leftConTitle']", level2_class: '.ant-form-item-label label' },
  'pingan.com': { group_class: '.edit-mode', level1_class: '.modules-title .title', level2_class: '.el-form-item__label' },
  'mihoyo.com': { group_class: '.rfe-resume-form-pc-form-list-renderer-content > .ant-row', level1_class: '.ant-card-head-title', level2_class: '.ant-form-item-label' },
  'jiandaoyun.com': {
    group_class: '.fx-subform-row',
    level1_class: '.sep-label',
    level2_class: '.field-name',
    option_container_selector: '.x-combo-dropdown-list',
    option_selector: '.x-combo-dropdown-item',
  },
  'yonyou.com': { group_class: '.form-cell-inner', level1_class: '.tit', level2_class: '.ant-form-item-label' },
  'xiaohongshu.com': { group_class: '.ant-row', level1_class: "[class*='text-h6']", level2_class: 'label.ant-form-item-required' },
  'job.byd.com': {
    group_class: '.list-form-container',
    level1_class: '.section-title .title',
    level2_class: '.el-form-item__label',
    delay_fill_selector: '[data-af-label="国籍"]',
  },
  'campus.10jqka.com': { group_class: '.blockForm', level1_class: '.aihr-title', level2_class: '.el-form-item__label' },
  'jobs.hujing-dme.com': {
    group_class: '.field-group-row',
    level1_class: '.uxcore-card-title',
    level2_class: '.label-content',
    option_container_selector: '.kuma-select2-dropdown',
    option_selector: '.kuma-select2-dropdown-menu-item',
  },
  'job.fandow.com': {
    group_class: '.ivu-row',
    level1_class: 'section.form-part h5.title',
    level2_class: '.ivu-form-item-label',
    option_container_selector: '.ivu-select-dropdown',
    option_selector: '.ivu-select-item',
  },
  'job.seasungames.cn': { group_class: "[class*='columnBox-']", level1_class: "[class*='columnTitle-']", level2_class: "[class*='labelText-']" },
};

// 三种通用招聘系统，靠页面上是否同时存在三级选择器来识别，不依赖域名。
export const ATS_MOKA = {
  kind: 'moka',
  group_class: "[class^='apply-block-'] [class^='apply-fields']",
  level1_class: "[class^='apply-block-'] [class^='blockTitle']",
  level2_class: "[class^='apply-block-'] [class^='title-']",
  option_container_selector: "[class*='sd-Dropdown-dropdown-']",
  option_selector: "[class*='sd-Menu-content-item']",
};

export const ATS_BEISEN = {
  kind: 'beisen',
  group_class: '[class~="ux-standard-form"]',
  level1_class: "[id*=\"_Recruitment_\"]:not(:has(*)), [class='dl_menutit']",
  level2_class: "[class^='form-item__text']",
  option_container_selector: "[class='phoenix-selectList__list']",
  option_selector: "[class*='phoenix-selectList__listItem']",
};

export const ATS_ATSX = {
  kind: 'atsx',
  group_class: '.resumeEditForm-item',
  level1_class: '.createFormSection-title',
  level2_class: '.atsx-form-item-label',
  option_container_selector: '.atsx-select-dropdown',
  option_selector: 'li[role="option"]',
};

function pageMatches({ group_class, level1_class, level2_class }) {
  try {
    return !!(document.querySelector(group_class) && document.querySelector(level1_class) && document.querySelector(level2_class));
  } catch {
    return false;
  }
}

/**
 * 识别当前页面的站点配置。优先识别通用招聘系统，再按域名匹配。
 * @returns {object | null}
 */
export function detectSite(hostname = location.hostname) {
  const host = hostname.replace(/^www\./, '');
  for (const ats of [ATS_BEISEN, ATS_MOKA, ATS_ATSX]) if (pageMatches(ats)) return ats;
  for (const domain of Object.keys(SITE_CONFIGS)) if (host.includes(domain)) return { kind: 'site', domain, ...SITE_CONFIGS[domain] };
  return null;
}
