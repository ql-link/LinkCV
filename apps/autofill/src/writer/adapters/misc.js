// iView、美团 mtd、kuma（UXCore）组件。

import { closestOf, findIn, queryVisible, realClick } from '../dom.js';
import { pickDate } from '../calendar.js';
import { selectFromPopupStrict, selectInCascader } from '../options.js';

async function openAndPick(el, popupSelector, config) {
  try {
    await realClick(el, 100);
    const popup = queryVisible(popupSelector);
    if (!popup) return false;
    return await pickDate({ ...config, container: popup });
  } catch {
    return false;
  }
}

export async function iviewAdapter(el, value, ctx) {
  if (closestOf(el, '.ivu-select')) {
    const cls = typeof el.className === 'string' ? el.className : '';
    const searchable = cls.includes('ivu-select-input') || findIn(el, 'ivu-select-input') != null;
    const trigger = el.querySelector('.ivu-select-selection') ?? el;
    return selectFromPopupStrict(trigger, value, { site: ctx.site, searchable });
  }
  if (closestOf(el, '.ivu-date-picker')) {
    const cells = '.ivu-date-picker-cells:not([style*="display: none"]) .ivu-date-picker-cells-cell';
    const ok = await openAndPick(el, '.ivu-date-picker', {
      dateStr: value,
      yearPanelSelector: '.ivu-date-picker-header-label:not([style*="display: none"])',
      yearElementSelector: cells,
      yearFilterClasses: false,
      decadeSelector: null,
      nextDecadeBtn: '.ivu-icon-ios-arrow-forward, .ivu-icon-ios-arrow-right',
      prevDecadeBtn: '.ivu-icon-ios-arrow-back, .ivu-icon-ios-arrow-left',
      monthConfig: null,
      monthElementSelector: cells,
      dayElementSelector: cells,
      yearRetryTimes: 20,
    });
    return { handled: true, success: ok };
  }
  if (closestOf(el, '.ivu-cascader')) {
    // iView 级联通过 menuItemSelector 定位每一级的选项。
    const ok = await selectInCascader(el, value, {
      dropdownSelectors: ['.ivu-select-dropdown:not([style*="display: none"])'],
      menuSelector: '.ivu-cascader-menu',
      menuItemSelector: '.ivu-cascader-menu-item',
    });
    return { handled: true, success: ok };
  }
  return { handled: false, success: false };
}

export async function mtdKumaAdapter(el, value, ctx) {
  if (closestOf(el, '.mtd-date-picker')) {
    const ok = await openAndPick(el, '.mtd-datepicker-pop', {
      dateStr: value,
      yearPanelSelector: '.mtd-month-calendar-year-btn',
      yearElementSelector: '.mtd-year-panel-list-data',
      yearFilterClasses: false,
      decadeSelector: '.mtd-month-calendar-year-header-range',
      nextDecadeBtn: '.right-switcher',
      prevDecadeBtn: '.left-switcher',
      monthConfig: null,
      monthElementSelector: '.mtd-month-panel-list-data',
      dayElementSelector: '.mtd-day-panel-list-data',
      yearRetryTimes: 30,
    });
    return { handled: true, success: ok };
  }
  if (closestOf(el, '.mtd-select')) return selectFromPopupStrict(el, value, { site: ctx.site, searchable: true });
  if (closestOf(el, 'kuma-calendar-picker-input')) {
    const ok = await openAndPick(el, '.kuma-calendar-picker', {
      dateStr: value,
      yearPanelSelector: '.kuma-calendar-month-panel-year-select-content',
      yearElementSelector: '.kuma-calendar-year-panel-cell',
      yearFilterClasses: false,
      decadeSelector: '',
      nextDecadeBtn: '.kuma-calendar-year-panel-next-decade-btn',
      prevDecadeBtn: '.kuma-calendar-year-panel-prev-decade-btn',
      monthConfig: null,
      monthElementSelector: '.kuma-calendar-month-panel-cell',
      dayElementSelector: '',
      yearRetryTimes: 30,
    });
    return { handled: true, success: ok };
  }
  return { handled: false, success: false };
}
