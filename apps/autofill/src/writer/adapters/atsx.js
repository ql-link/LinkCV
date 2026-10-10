// atsx-* 组件（一套基于 antd 改前缀的招聘系统组件库）。

import { sleep, textOf, closestOf, findIn, realClick, dispatchBlur } from '../dom.js';
import { monthNames, parseYear } from '../calendar.js';
import { selectInTree, selectFromPopupStrict } from '../options.js';

const DROPDOWN = '.atsx-select-dropdown:not(.atsx-select-dropdown-hidden)';
const TREE = '.atsx-select-tree-wrapper, .atsx-select-tree';
const TREE_TITLE = '.atsx-tree-title, .atsx-select-tree-node-content-wrapper';
const TREE_SWITCHER = '.atsx-tree-switcher, .atsx-select-tree-switcher';
const DATE_DROPDOWN = '.atsx-date-picker-dropdown:not(.atsx-date-picker-dropdown-hidden)';

async function atsxSelect(el, value, ctx) {
  try {
    const trigger = closestOf(el, '.atsx-select-selection') || findIn(el, '.atsx-select-selection') || el;
    await realClick(trigger, 200);
    const popup = document.querySelector(DROPDOWN);
    if (popup?.querySelector(TREE)) {
      const ok = await selectInTree(popup, value, {
        wrapper: TREE,
        title: TREE_TITLE,
        switcher: TREE_SWITCHER,
        clickTarget: async (t) => {
          t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await sleep(10);
        },
      });
      dispatchBlur(el);
      await sleep(10);
      return ok;
    }
    const searchable = (closestOf(el, '.atsx-select-search') || findIn(el, '.atsx-select-search')) !== null;
    return (await selectFromPopupStrict(el, value, { site: ctx.site, searchable })).success;
  } catch {
    dispatchBlur(el);
    return false;
  }
}

const clickEvent = () => new MouseEvent('click', { bubbles: true });

// 年月区间：每个端点有一个标签，点开后左列选年、右列选月。
// 调用方当前将同一个值传给开始和结束；不同端点需要分别传入对应值。
async function atsxMonthPeriod(el, start, end) {
  const box = closestOf(el, 'atsx-date-picker-period-month');
  if (!box) return false;
  const labels = box.querySelectorAll('.atsx-date-picker-period-month-label');
  if (!labels.length) return false;
  const dates = [start, end];
  for (let i = 0; i < labels.length; i++) {
    const [year, month] = String(dates[i] ?? '').split('-').map((n) => parseInt(n, 10));
    labels[i].dispatchEvent(clickEvent());
    await sleep(10);
    const popup = document.querySelector(DATE_DROPDOWN);
    if (!popup) return false;
    const lists = popup.querySelectorAll('.atsx-date-picker-period-month-panel-list');
    if (lists.length < 2) return false;
    let yearCell = null;
    lists[0].querySelectorAll('.atsx-date-picker-period-month-panel-list-item').forEach((c) => {
      if (textOf(c) === String(year)) yearCell = c;
    });
    if (!yearCell) return false;
    yearCell.click();
    await sleep(10);
    const names = monthNames(month);
    let monthCell = null;
    lists[1].querySelectorAll('.atsx-date-picker-period-month-panel-list-item').forEach((c) => {
      if (names.includes(textOf(c).replace(/\s+/g, ''))) monthCell = c;
    });
    if (!monthCell) return false;
    monthCell.click();
    await sleep(10);
  }
  return true;
}

async function atsxDate(el, value) {
  const focus = new Event('focus');
  el.dispatchEvent(focus);
  el.dispatchEvent(clickEvent());
  await sleep(10);
  const panel = document.querySelector(DATE_DROPDOWN);
  if (!panel) return false;
  const [year, month, day] = String(value).split('-').map((n) => parseInt(n, 10));

  async function selectMonthAndDay() {
    for (let attempt = 0; attempt < 2; attempt++) {
      const popup = document.querySelector(DATE_DROPDOWN);
      if (!popup) return true;
      const names = monthNames(month);
      let cell = null;
      popup.querySelectorAll('.atsx-date-picker-panel-body-cell-content').forEach((c) => {
        if (names.includes(textOf(c).replace(/\s+/g, ''))) cell = c;
      });
      if (!cell) {
        await sleep(10);
        continue;
      }
      cell.dispatchEvent(focus);
      cell.dispatchEvent(clickEvent());
      cell.click();
      await sleep(10);
      const days = popup.querySelectorAll('.atsx-date-picker-panel-body-date-cell-inner-content');
      if (!days.length) return true;
      const hit = Array.from(days).find((d) => parseInt(textOf(d), 10) === day);
      if (!hit) return false;
      hit.click();
      await sleep(10);
      return true;
    }
    return false;
  }

  async function selectYear() {
    for (let retries = 10; retries > 0; retries--) {
      let cell = null;
      panel.querySelectorAll('.atsx-date-picker-panel-body-cell-content').forEach((c) => {
        if (textOf(c) === String(year)) cell = c;
      });
      if (cell) {
        cell.click();
        await sleep(150);
        const popup = document.querySelector(DATE_DROPDOWN);
        if (!popup) return true;
        // 只选年份的控件点完仍停在年份面板，视为完成。
        if (popup.querySelector('.atsx-date-picker-panel-body-year')) return true;
        return selectMonthAndDay();
      }
      const current = parseYear(panel.querySelector('.atsx-date-picker-panel-header-title')?.textContent || '');
      if (current == null) return false;
      panel.querySelector(year > current ? '[data-cy="next"]' : '[data-cy="prev"]')?.click();
      await sleep(10);
    }
    return false;
  }

  if (panel.querySelector('.atsx-date-picker-panel-body-year')) return selectYear();
  const ops = panel.querySelectorAll('.atsx-date-picker-panel-header-operator:not([data-cy="next"]):not([data-cy="prev"])');
  const toYear = ops.length === 1 ? ops[0] : panel.querySelector('.atsx-date-picker-panel-header-operator[data-cy="year"]');
  if (!toYear) return false;
  toYear.click();
  await sleep(100);
  return selectYear();
}

export async function atsxAdapter(el, value, ctx) {
  if (closestOf(el, '.atsx-select')) return { handled: true, success: await atsxSelect(el, value, ctx) };
  if (el instanceof HTMLInputElement && !el.classList.contains('atsx-date-picker-period-hidden-input')) {
    if (closestOf(el, 'atsx-date-picker-period-month')) {
      return { handled: true, success: await atsxMonthPeriod(el, value, value).catch(() => false) };
    }
    const picker = closestOf(el, 'atsx-date-picker');
    if (picker && !picker.classList.contains('atsx-date-picker-period-month')) {
      return { handled: true, success: await atsxDate(el, value).catch(() => false) };
    }
  }
  return { handled: false, success: false };
}
