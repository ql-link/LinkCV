// 通用日历导航：翻到目标年份 → 选月份 → 选日期。各组件库只提供选择器预设。
// dateStr 格式为 YYYY-MM-DD 或 YYYY-MM。

import { sleep, textOf, queryAllVisible, isVisible, realClick } from './dom.js';

const MONTH_NAMES = [
  ['一月', '1月', '01', '1', 'Jan', '01月'],
  ['二月', '2月', '02', '2', 'Feb', '02月'],
  ['三月', '3月', '03', '3', 'Mar', '03月'],
  ['四月', '4月', '04', '4', 'Apr', '04月'],
  ['五月', '5月', '05', '5', 'May', '05月'],
  ['六月', '6月', '06', '6', 'Jun', '06月'],
  ['七月', '7月', '07', '7', 'Jul', '07月'],
  ['八月', '8月', '08', '8', 'Aug', '08月'],
  ['九月', '9月', '09', '9', 'Sept', '09月'],
  ['十月', '10月', '10', '10', 'Oct', '10月'],
  ['十一月', '11月', '11', '11', 'Nov', '11月'],
  ['十二月', '12月', '12', '12', 'Dec', '12月'],
];

export function monthNames(month) {
  return MONTH_NAMES[month - 1] || [];
}

// 从“2019年 - 2028年”“2024年”“2024”这类表头文字里取年份，区间取后一个。
export function parseYear(text) {
  for (const [re, group] of [
    [/(\d{4})\s*年\s*-\s*(\d{4})\s*年/, 2],
    [/(\d{4})\s*年/, 1],
    [/(\d{4})/, 1],
  ]) {
    const m = text.match(re);
    if (m) return parseInt(m[group], 10);
  }
  return null;
}

function parseMonth(text) {
  for (const [re, group] of [
    [/(\d{4})\s*年\s*(\d{1,2})\s*月/, 2],
    [/(\d{1,2})\s*月/, 1],
  ]) {
    const m = text.match(re);
    if (m) return parseInt(m[group], 10);
  }
  return null;
}

export const CALENDAR_PRESETS = {
  antCalendarWithYearSelect: {
    yearPanelSelector: '.ant-calendar-year-select',
    yearElementSelector:
      '.ant-calendar-year-panel-cell:not(.ant-calendar-year-panel-cell-disabled):not(.ant-calendar-year-panel-last-decade-cell):not(.ant-calendar-year-panel-next-decade-cell)',
    yearFilterClasses: false,
    decadeSelector: '.ant-calendar-year-panel-decade-select-content',
    nextDecadeBtn: '.ant-calendar-year-panel-next-decade-btn',
    prevDecadeBtn: '.ant-calendar-year-panel-prev-decade-btn',
    monthConfig: '.ant-calendar-month-select',
    monthElementSelector: '.ant-calendar-month-panel-month',
    dayElementSelector: '.ant-calendar-date',
    yearRetryTimes: 60,
    monthRetryTimes: 12,
  },
  antCalendar: {
    yearPanelSelector: null,
    yearElementSelector: '.ant-calendar-month-panel-year-select-content',
    yearFilterClasses: true,
    decadeSelector: '.ant-calendar-year-panel-decade-select-content',
    nextDecadeBtn: '.ant-calendar-month-panel-next-year-btn',
    prevDecadeBtn: '.ant-calendar-month-panel-prev-year-btn',
    monthConfig: '',
    monthElementSelector: '.ant-calendar-month-panel-month',
    dayElementSelector: '.ant-calendar-date',
    yearRetryTimes: 60,
    monthRetryTimes: 12,
  },
  antPicker: {
    yearPanelSelector: '.ant-picker-year-btn',
    yearElementSelector: '.ant-picker-cell-in-view',
    yearFilterClasses: false,
    decadeSelector: '.ant-picker-decade-btn',
    nextDecadeBtn: '.ant-picker-header-super-next-btn',
    prevDecadeBtn: '.ant-picker-header-super-prev-btn',
    monthConfig: '.ant-picker-month-btn',
    monthElementSelector: '.ant-picker-cell',
    dayElementSelector: '.ant-picker-cell',
    yearRetryTimes: 60,
    monthRetryTimes: 12,
  },
  elDatePicker: {
    yearPanelSelector: '.el-date-picker__header-label:not([style*="display: none"])',
    yearElementSelector: '.el-year-table a.cell, .el-year-table span.cell',
    yearFilterClasses: ['disabled'],
    decadeSelector: '.el-date-picker__header-label:not([style*="display: none"])',
    nextDecadeBtn: '.el-date-picker__next-btn button:not([style*="display: none"]), .el-date-picker__next-btn',
    prevDecadeBtn: '.el-date-picker__prev-btn button:not([style*="display: none"]), .el-date-picker__prev-btn',
    monthConfig: null,
    monthElementSelector: '.el-month-table a.cell, .el-month-table span.cell',
    dayElementSelector: '.el-date-table td.available',
    yearRetryTimes: 40,
    monthRetryTimes: 12,
  },
  antDateRange: {
    yearPanelSelector: '.ant-calendar-year-select',
    yearElementSelector: '.ant-calendar-year-panel-year',
    yearFilterClasses: true,
    decadeSelector: '.ant-calendar-year-panel-decade-select-content',
    nextDecadeBtn: '.ant-calendar-year-panel-next-decade-btn',
    prevDecadeBtn: '.ant-calendar-year-panel-prev-decade-btn',
    monthConfig: { prevMonthSelector: '.ant-calendar-prev-month-btn', nextMonthSelector: '.ant-calendar-next-month-btn' },
    monthElementSelector: '.ant-calendar-month-select',
    dayElementSelector: '.ant-calendar-date',
    yearRetryTimes: 60,
    monthRetryTimes: 12,
  },
  feishu: {
    yearPanelSelector: '.ud__picker-panel-header-btn',
    yearElementSelector: '.ud__picker__cell-interactive-area',
    yearFilterClasses: null,
    decadeSelector: null,
    nextDecadeBtn: '.ud__picker-panel-header-inner > button:nth-child(1)',
    prevDecadeBtn: '.ud__picker-panel-header-inner > button:nth-child(2)',
    monthConfig: null,
    monthElementSelector: '.ud__picker__cell-interactive-area',
    dayElementSelector: '.ud__picker__cell-interactive-area',
    yearRetryTimes: 60,
    monthRetryTimes: 12,
  },
  moka: {
    yearPanelSelector: '[class^="sd-basic-selector-year"]',
    yearElementSelector: '[class^="sd-basic-year-item"]',
    yearFilterClasses: true,
    decadeSelector: '[class^="sd-basic-selector-year"]',
    nextDecadeBtn: '[class*="sd-Icon-icondoubleRight"]',
    prevDecadeBtn: '[class*="sd-Icon-icondoubleLeft"]',
    monthConfig: '[class^="sd-basic-selector-month"]',
    monthElementSelector: '[class^="sd-basic-year-item"]',
    dayElementSelector: '[class*="sd-basic-date-item"]',
    yearRetryTimes: 60,
    monthRetryTimes: 12,
  },
};

/**
 * 在已打开的日历浮层里选中日期。
 * yearPanelSelector 为 null 时用“表头文字 + 前后翻页”模式定位年份，否则先切到年份网格再点选。
 * monthConfig 为字符串时是“切到月份面板”的按钮；为对象时用上/下月按钮逐月翻。
 * yearFilterClasses 为 true 时跳过网格首尾两个跨十年格；为数组时跳过带这些类名的格子。
 * @returns {Promise<boolean>}
 */
export async function pickDate(config) {
  let { container } = config;
  const {
    dateStr,
    yearPanelSelector,
    yearElementSelector,
    yearFilterClasses,
    decadeSelector,
    nextDecadeBtn,
    prevDecadeBtn,
    monthConfig,
    monthElementSelector,
    dayElementSelector,
    yearRetryTimes = 60,
    subContainerSelector = null,
    monthRetryTimes = 10,
  } = config;
  const root = container;
  // 双面板日期区间：每次操作前重新定位左/右子面板，翻页后 DOM 会被替换。
  const refresh = () => {
    if (!subContainerSelector) return;
    const sub = root.querySelector(subContainerSelector);
    if (sub) container = sub;
  };

  let [year, month, day] = String(dateStr).split('-').map((n) => parseInt(n, 10));
  if (isNaN(day)) day = 1;
  const yearOk = !isNaN(year) && year >= 1900 && year <= 2100;
  const monthOk = !isNaN(month) && month >= 1 && month <= 12;
  const dayOk = !isNaN(day) && day >= 1 && day <= 31;
  if (!yearOk && !monthOk && !dayOk) return false;

  async function selectDay() {
    if (!dayElementSelector || !dayOk) return true;
    refresh();
    await sleep(50);
    // 月份选择器在选完月份后会自动关闭，此时没有日期面板，视为成功。
    if (!isVisible(container)) return true;
    const cells = queryAllVisible(dayElementSelector, container);
    if (!cells.length) return true;
    if (textOf(cells[0]).includes('月')) return true;
    const hits = cells.filter((c) => parseInt(textOf(c), 10) === day);
    // 日期网格首尾会混入上/下月的日期，前半月取第一个、后半月取最后一个。
    const cell = day <= 15 ? hits[0] : hits[hits.length - 1];
    if (!cell) return false;
    cell.click();
    await sleep(100);
    return true;
  }

  async function selectMonth() {
    if (!monthElementSelector || !monthOk) return selectDay();
    refresh();
    if (monthConfig == null || typeof monthConfig !== 'object') {
      if (monthConfig) {
        const toMonthPanel = container.querySelector(monthConfig);
        if (toMonthPanel) {
          toMonthPanel.click();
          refresh();
          await sleep(100);
        }
      }
      const names = monthNames(month);
      let hit = null;
      container.querySelectorAll(monthElementSelector).forEach((c) => {
        if (names.includes(textOf(c).replace(/\s+/g, ''))) hit = c;
      });
      if (!hit) return false;
      await realClick(hit);
      return selectDay();
    }
    let retries = monthRetryTimes;
    while (retries > 0) {
      let current = textOf(container.querySelector(monthElementSelector));
      const parsed = parseMonth(current);
      if (parsed != null) current = String(parsed);
      if (parseInt(current, 10) === month) return selectDay();
      const btn = month > parseInt(current, 10) ? container.querySelector(monthConfig.nextMonthSelector) : container.querySelector(monthConfig.prevMonthSelector);
      btn?.click();
      retries--;
      await sleep(100);
    }
    return false;
  }

  async function selectYear() {
    let retries = yearRetryTimes;
    while (true) {
      if (!yearElementSelector || !yearOk) return selectMonth();
      if (retries <= 0) return false;
      if (yearPanelSelector == null) {
        let current = textOf(container.querySelector(yearElementSelector));
        const parsed = parseYear(current);
        if (parsed != null) current = String(parsed);
        if (parseInt(current, 10) === year) return selectMonth();
        const forward = year > parseInt(current, 10);
        const btn = container.querySelector(forward ? nextDecadeBtn : prevDecadeBtn);
        if (btn) btn.click();
        else if (monthConfig && typeof monthConfig === 'object') {
          container.querySelector(forward ? monthConfig.nextMonthSelector : monthConfig.prevMonthSelector)?.click();
        }
        retries--;
        await sleep(50);
        continue;
      }
      const cells = container.querySelectorAll(yearElementSelector);
      let hit = null;
      cells.forEach((c, i) => {
        const t = textOf(c);
        if (t !== String(year) && parseYear(t) !== year) return;
        if (yearFilterClasses === true) {
          if (i !== 0 && i !== cells.length - 1) hit = c;
        } else if (Array.isArray(yearFilterClasses)) {
          if (!yearFilterClasses.some((k) => c.closest(`.${k}`))) hit = c;
        } else hit = c;
      });
      if (hit) {
        hit.click();
        await sleep(100);
        return selectMonth();
      }
      let reference = null;
      if (decadeSelector) {
        const decade = container.querySelector(decadeSelector);
        const parsed = decade ? parseYear(decade.textContent || '') : null;
        if (parsed != null) reference = parsed;
      } else {
        const last = parseInt(textOf(cells[cells.length - 1]), 10);
        if (!isNaN(last)) reference = last;
      }
      if (reference == null) return false;
      container.querySelector(year >= reference ? nextDecadeBtn : prevDecadeBtn)?.click();
      retries--;
      await sleep(100);
    }
  }

  try {
    refresh();
    if (yearPanelSelector != null) {
      const toYearPanel = container.querySelector(yearPanelSelector);
      if (toYearPanel) {
        toYearPanel.click();
        await sleep(100);
        refresh();
      }
    }
    return await selectYear();
  } catch {
    return false;
  }
}

export function pickDateWithPreset(preset, container, dateStr) {
  const config = CALENDAR_PRESETS[preset];
  if (!config) throw new Error(`未找到日期选择器预设: ${preset}`);
  return pickDate({ ...config, container, dateStr });
}
