// Ant Design（v3 的 ant-calendar 与 v4/v5 的 ant-picker 都支持）。

import { sleep, closestOf, findIn, queryVisible, realClick, waitFor, dispatchBlur } from '../dom.js';
import { setValueWithEvents, typeText } from '../input.js';
import { pickOption } from '../match.js';
import { pickDate, pickDateWithPreset, CALENDAR_PRESETS } from '../calendar.js';
import { ANTD_DROPDOWN, ANTD_OPTION, optionsIn, clickMatchingOption, typeAndCollect, selectInTree, selectInCascader } from '../options.js';

const SEL = {
  SELECT_SEARCH_INPUT: '.ant-select-search__field',
  SELECT_TREE_WRAPPER: '.ant-select-tree-wrapper',
  TREE_TITLE: '.ant-select-tree-title',
  TREE_SWITCHER: '.ant-select-tree-switcher',
  CALENDAR_PICKER: '.ant-calendar-picker',
  CALENDAR_CONTAINER: '.ant-calendar-picker-container:not(.slide-up-leave):not([style*="display: none"])',
  PICKER: '.ant-picker',
  PICKER_DROPDOWN: '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
  CASCADER_DROPDOWN: '.ant-cascader-dropdown:not(.ant-select-dropdown-hidden)',
  CASCADER_MENU: '.ant-cascader-menu',
  CASCADER_MENU_ITEM: '.ant-cascader-menu-item, .ant-menu-title-content',
  MODAL: '.ant-modal:not([data-af-closed="true"]):not([style*="display: none"])',
};

const isCascader = (el) => closestOf(el, '.ant-cascader, .ant-cascader-picker') !== null;
export const isAntSelect = (el) => isCascader(el) || !!(closestOf(el, '.ant-select') || closestOf(el, '.ant-select-selector'));
const isAntInput = (el) => (typeof el.className === 'string' ? el.className : '').includes('ant-input');

function antCascader(el, value) {
  return selectInCascader(el, value, {
    dropdownSelectors: [SEL.CASCADER_DROPDOWN, '.ant-modal-wrap:not([style*="display: none"])', '.ant-cascader-menus:not([style*="display: none"])'],
    menuSelector: SEL.CASCADER_MENU,
    menuItemSelector: SEL.CASCADER_MENU_ITEM,
  });
}

function searchInputOf(el) {
  if (el instanceof HTMLInputElement) return el;
  return el.querySelector(SEL.SELECT_SEARCH_INPUT) || el.querySelector('input[type="text"]') || el.querySelector('input[type="search"]');
}

const collectAntOptions = (popup) => optionsIn(popup, ANTD_OPTION);

// 普通/可搜索 Select：先看已展开的选项；可搜索时输入目标值重新拉取；最后清空搜索词，用本地匹配在完整列表里挑。
async function selectAntOption(el, value, searchable) {
  let popup = queryVisible(ANTD_DROPDOWN);
  if (!popup) {
    if (!searchable) return false;
    const input = searchInputOf(el);
    if (!input) return false;
    await setValueWithEvents(input, value);
    await waitFor(() => (popup = queryVisible(ANTD_DROPDOWN)) != null, 100, 10);
    if (!popup) return false;
  }
  let options = [];
  await waitFor(() => (options = collectAntOptions(popup)).length > 0, 10, 100);
  if (await clickMatchingOption(el, options, value, { useMatcher: false, waitAfter: 50 })) {
    return true;
  }
  const input = searchInputOf(el);
  let typed = false;
  if (searchable) {
    typed = input != null;
    const found = await typeAndCollect(input, value, () => collectAntOptions(popup));
    if (found.length) {
      const best = pickOption(found.map((o) => o.text), value);
      const hit = best && found.find((o) => o.text === best);
      if (hit) {
        await realClick(hit.element, 300);
        return true;
      }
    }
  }
  if (typed && input) {
    await setValueWithEvents(input, '');
    await sleep(300);
    const all = collectAntOptions(popup);
    if (all.length) options = all;
  }
  if (options.length) {
    const best = pickOption(options.map((o) => o.text), value);
    if (best) {
      const hit = options.find((o) => o.text === best);
      if (hit) {
        await realClick(hit.element, 300);
        return true;
      }
      const found = await typeAndCollect(input, best, () => collectAntOptions(popup));
      const again = found.find((o) => o.text === best);
      if (again) {
        await realClick(again.element, 300);
        return true;
      }
    }
  }
  return false;
}

async function antSelect(el, value, label) {
  const input = searchInputOf(el);
  const before = input?.value;
  let success = false;
  try {
    if (isCascader(el)) return await antCascader(el, value);
    const trigger = closestOf(el, '.ant-select-selector') || findIn(el, '.ant-select-selector') || el;
    await realClick(trigger, 200);
    const popup = queryVisible(ANTD_DROPDOWN);
    if (!popup && queryVisible(SEL.CASCADER_MENU)) return await antCascader(el, value);
    if (popup && queryVisible(SEL.SELECT_TREE_WRAPPER)) {
      const ok = await selectInTree(popup, value, { wrapper: SEL.SELECT_TREE_WRAPPER, title: SEL.TREE_TITLE, switcher: SEL.TREE_SWITCHER });
      dispatchBlur(el);
      await sleep(10);
      return ok;
    }
    const searchable = /学校|专业/.test(label) || findIn(el, '.ant-select-search') !== null || closestOf(el, '.ant-select-selection-search') !== null;
    const ok = await selectAntOption(el, value, searchable);
    success = ok;
    dispatchBlur(el);
    await sleep(10);
    return ok;
  } catch {
    dispatchBlur(el);
    return false;
  } finally {
    if (!success && input && before != null && input.value !== before) await setValueWithEvents(input, before, 0);
  }
}

async function closeModal(modal) {
  const close = modal.querySelector('.ant-modal-close');
  if (close) await realClick(close, 50);
}

// 只读输入框点击后弹出对话框，在对话框里单选/多选后点“确定”。
async function antInputWithModal(el, value) {
  let ok = false;
  try {
    el.dispatchEvent(new Event('focus'));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(100);
    const modal = document.querySelector(SEL.MODAL);
    if (!modal) return false;
    try {
      const area = ['.subject-wrap', '.subject-item-children', '.ant-modal-body'].map((s) => modal.querySelector(s)).find(Boolean) || modal;
      let items = null;
      for (const s of ['.subject-item', '.ant-radio-wrapper', '.ant-checkbox-wrapper']) {
        items = area.querySelectorAll(s);
        if (items.length) break;
      }
      if (!items?.length) {
        await closeModal(modal);
        return false;
      }
      const options = Array.from(items)
        .map((i) => ({ text: i.textContent?.trim() || '', element: i }))
        .filter((o) => o.text);
      ok = await clickMatchingOption(el, options, value);
      if (ok) {
        await sleep(100);
        const confirm = modal.querySelector('.ant-modal-footer .ant-btn-primary');
        if (confirm) await realClick(confirm, 50);
      } else await closeModal(modal);
    } finally {
      // 对话框关闭有动画，打标记避免下一个字段误认为它还开着。
      modal.setAttribute('data-af-closed', 'true');
    }
  } catch {
    ok = false;
  } finally {
    dispatchBlur(el);
  }
  return ok;
}

// 日期区间由两个输入框组成，按顺序先收到开始值、再收到结束值时一次性在浮层里选完。
let rangeState = null;

async function fillAntCalendarRange(startEl, start, end) {
  const wrapper = closestOf(startEl, 'ant-calendar-picker-input');
  if (!wrapper) return false;
  startEl.dispatchEvent(new Event('focus'));
  startEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(10);
  const popup = document.querySelector(SEL.CALENDAR_CONTAINER);
  if (!popup) return false;
  const range = CALENDAR_PRESETS.antDateRange;
  const has = (s) => !!(s && popup.querySelector(s));
  const mc = range.monthConfig;
  const fullRange = (has(range.yearPanelSelector) && (has(range.decadeSelector) || has(range.nextDecadeBtn) || has(range.prevDecadeBtn)) && (has(mc?.nextMonthSelector) || has(mc?.prevMonthSelector))) || (typeof mc === 'string' && has(mc));
  const preset = fullRange ? range : CALENDAR_PRESETS.antCalendar;
  const halves = ['.ant-calendar-range-left', '.ant-calendar-range-right'];
  for (let i = 0; i < 2; i++) {
    if (!(await pickDate({ ...preset, container: popup, dateStr: [start, end][i], subContainerSelector: halves[i] }))) return false;
  }
  return true;
}

async function fillAntPickerRange(startEl, start, end) {
  if (!closestOf(startEl, 'ant-picker-range')) return false;
  try {
    await realClick(startEl, 100);
    const popup = queryVisible(SEL.PICKER_DROPDOWN);
    if (!popup) return false;
    const monthBtn = popup.querySelector('.ant-picker-month-btn') ? '.ant-picker-month-btn' : null;
    const panels = ['.ant-picker-panel:first-child', '.ant-picker-panel:last-child'];
    for (let i = 0; i < 2; i++) {
      const ok = await pickDate({
        container: popup,
        dateStr: [start, end][i],
        yearPanelSelector: i === 0 ? '.ant-picker-year-btn' : null,
        yearElementSelector: i === 0 ? '.ant-picker-cell-in-view' : '.ant-picker-year-btn',
        yearFilterClasses: false,
        decadeSelector: '.ant-picker-decade-btn',
        nextDecadeBtn: '.ant-picker-header-super-next-btn',
        prevDecadeBtn: '.ant-picker-header-super-prev-btn',
        monthConfig: monthBtn,
        monthElementSelector: '.ant-picker-cell',
        dayElementSelector: '.ant-picker-cell',
        yearRetryTimes: 30,
        subContainerSelector: panels[i],
      });
      if (!ok) return false;
      await sleep(100);
    }
    return true;
  } finally {
    dispatchBlur(startEl);
  }
}

async function fillAntCalendar(el, value) {
  if (!document.querySelector(SEL.CALENDAR_CONTAINER)) {
    el.dispatchEvent(new Event('focus'));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(10);
  }
  const popup = document.querySelector(SEL.CALENDAR_CONTAINER);
  if (!popup) return false;
  const preset = popup.querySelector('.ant-calendar-year-select') ? 'antCalendarWithYearSelect' : 'antCalendar';
  return pickDateWithPreset(preset, popup, value);
}

async function fillAntPicker(el, value) {
  try {
    await realClick(el, 100);
    const popup = queryVisible(SEL.PICKER_DROPDOWN);
    if (!popup) return false;
    return await pickDateWithPreset('antPicker', popup, value);
  } finally {
    dispatchBlur(el);
  }
}

export async function antdAdapter(el, value, ctx) {
  const cls = typeof el.className === 'string' ? el.className : '';
  const isOldRange = closestOf(el, '.ant-calendar-range-picker-input');
  const isNewRange = closestOf(el, '.ant-picker-range') != null;
  if (isOldRange || isNewRange) {
    // 当前单字段调用没有同一控件两个端点的确定契约，不跨字段暂存并猜测区间。
    return { handled: true, success: false, skipped: true };
  }
  if (cls.includes('ant-calendar') || el.closest(SEL.CALENDAR_PICKER) || closestOf(el, '.ant-col [class*=" u-date"]')) {
    return { handled: true, success: await fillAntCalendar(el, value).catch(() => false) };
  }
  if (cls.includes('ant-picker') || closestOf(el, SEL.PICKER)) {
    return { handled: true, success: await fillAntPicker(el, value).catch(() => false) };
  }
  if (isAntSelect(el)) return { handled: true, success: await antSelect(el, value, ctx.label) };
  if (isAntInput(el)) {
    if (await antInputWithModal(el, value)) return { handled: true, success: true };
    // 没有可用的选择对话框时直接输入，输入过程未抛错则返回成功。
    try {
      await typeText(el, value);
      return { handled: true, success: true };
    } catch {
      return { handled: true, success: false };
    }
  }
  return { handled: false, success: false };
}
