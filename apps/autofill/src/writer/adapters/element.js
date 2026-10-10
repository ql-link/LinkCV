// Element UI / Element Plus。

import { sleep, closestOf, queryVisible, realClick, dispatchBlur } from '../dom.js';
import { pickDate, pickDateWithPreset } from '../calendar.js';
import { selectFromPopup, selectFromPopupStrict, selectInCascader } from '../options.js';

const RANGE_PICKER = '.el-date-range-picker:not([style*="display: none"])';
const HALVES = [
  '.el-date-range-picker__content.is-left, .el-picker-panel__content:first-child, .el-date-range-picker__content:first-child',
  '.el-date-range-picker__content.is-right, .el-picker-panel__content:last-child, .el-date-range-picker__content:last-child',
];

let rangeState = null;

async function fillRange(startEl, rangeBox, start, end) {
  const inputs = rangeBox.querySelectorAll('input');
  if (inputs.length < 2) return false;
  inputs[0].dispatchEvent(new Event('focus'));
  await realClick(inputs[0], 100);
  await sleep(10);
  const popup = queryVisible(RANGE_PICKER);
  if (!popup) return false;
  const monthOnly = closestOf(startEl, 'el-date-editor--monthrange') != null;
  for (let i = 0; i < 2; i++) {
    const ok = await pickDate({
      container: popup,
      dateStr: [start, end][i],
      yearPanelSelector: null,
      yearElementSelector: '.el-date-range-picker__header-label, .el-date-range-picker__header',
      yearFilterClasses: false,
      decadeSelector: '.el-date-range-picker__header-label, .el-date-range-picker__header',
      nextDecadeBtn: '.el-icon-d-arrow-right:not(.is-disabled), .d-arrow-right, .el-date-range-picker__next-btn',
      prevDecadeBtn: '.el-icon-d-arrow-left:not(.is-disabled), .d-arrow-left, .el-date-range-picker__prev-btn',
      monthConfig: monthOnly ? null : { prevMonthSelector: '.el-icon-arrow-left, .arrow-left', nextMonthSelector: '.el-icon-arrow-right, .arrow-right' },
      monthElementSelector: monthOnly
        ? '.el-month-table a.cell, .el-month-table span.cell, .el-month-table .cell, .cell'
        : '.el-date-range-picker__header-label, .el-date-range-picker__header',
      dayElementSelector: monthOnly ? '' : 'td.available',
      yearRetryTimes: 40,
      monthRetryTimes: 24,
      subContainerSelector: HALVES[i],
    });
    if (!ok) return false;
    await sleep(50);
  }
  return true;
}

// 日期区间：第一次调用记下开始值，第二次（结束输入框）调用时一起选。
async function handleRange(el, value) {
  const v = String(value ?? '').trim();
  const box = closestOf(el, 'el-date-editor--daterange') || closestOf(el, 'el-range-editor') || closestOf(el, 'el-date-editor--monthrange');
  if (!box && rangeState) rangeState = null;
  if (!box) return { handled: false, success: false };
  const inputs = box.querySelectorAll('input');
  if (inputs.length < 2) return { handled: true, success: false };
  if (el !== inputs[0] && el !== inputs[1]) return { handled: true, success: false };
  if (!rangeState || rangeState.box !== box) {
    rangeState = { box, startElement: el, startDate: v };
    return { handled: true, success: true };
  }
  if (rangeState.startElement === el) {
    rangeState.startDate = v;
    return { handled: true, success: true };
  }
  const { startElement, startDate } = rangeState;
  rangeState = null;
  if (!startDate) return { handled: true, success: false };
  try {
    return { handled: true, success: await fillRange(startElement, box, startDate, v) };
  } catch {
    return { handled: true, success: false };
  }
}

async function fillDate(el, value) {
  try {
    await realClick(el, 100);
    const popup = queryVisible('.el-date-picker:not([style*="display: none"])');
    if (!popup) return false;
    return await pickDateWithPreset('elDatePicker', popup, value);
  } catch {
    return false;
  } finally {
    dispatchBlur(el);
  }
}

export async function elementAdapter(el, value, ctx) {
  const range = await handleRange(el, value);
  if (range.handled) return range;
  if (closestOf(el, 'el-date-editor')) return { handled: true, success: await fillDate(el, value) };
  if (closestOf(el, '.el-cascader')) {
    const ok = await selectInCascader(el, value, {
      dropdownSelectors: ['.el-cascader__dropdown:not([style*="display: none"])'],
      menuSelector: '.el-cascader-menu',
      menuItemSelector: '.el-cascader-node',
    });
    return { handled: true, success: ok };
  }
  if (closestOf(el, '.el-select')) return selectFromPopupStrict(el, value, { site: ctx.site });
  if (closestOf(el, '.el-dropdown')) {
    const link = el.querySelector('.el-dropdown-link');
    if (link) return selectFromPopup(link, value, { label: ctx.label, site: ctx.site });
  }
  return { handled: false, success: false };
}
