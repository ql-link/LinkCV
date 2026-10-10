// 北森（phoenix-* 组件）。下拉、日期和地区选择都在页面级浮层 .common-unmodeled-layer 中渲染。

import { sleep, textOf, isVisible, waitFor, clickBlank } from '../dom.js';
import { typeText, pressKey, setValueWithEvents } from '../input.js';
import { pickOption, splitPath } from '../match.js';
import { pickDate } from '../calendar.js';
import { collectOptions } from '../options.js';

const LAYER = '.common-unmodeled-layer:not(.common-unmodeled-layer-hidden)';
const LIST = '.list-data-container, .area-data-container, .phoenix-selectList';
const LIST_ITEM = '.list-item-container, .area-item-name, .phoenix-selectList__listItem';
const CONFIRM = '.phoenix-button__wraper--primary, .phoenix-button--primary';

const isBlank = (v) => !v || !String(v).trim() || ['undefined', 'null', 'NaN'].includes(v);

function isShown(el) {
  if (!el) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// 浮层与触发输入框通过 data-af-input-id 绑定；没绑定时取 z-index 最高的那个。
function topLayer(el) {
  const layers = document.querySelectorAll(LAYER);
  if (!layers.length) return null;
  const id = el?.getAttribute('data-af-id');
  if (id) for (const layer of layers) if (layer.getAttribute('data-af-input-id') === id) return layer;
  let best = null;
  let top = -1;
  layers.forEach((layer) => {
    const z = parseInt(getComputedStyle(layer).zIndex || '0', 10);
    if (z > top) [top, best] = [z, layer];
  });
  return best;
}

function bindLayer(layer, id) {
  if (layer && id && !layer.getAttribute('data-af-input-id')) layer.setAttribute('data-af-input-id', id);
}

// 输入文本，按需回车。返回该字段是否属于“学校名称”这类远程搜索字段。
async function typeThenMaybeEnter(el, value, ctx, pressEnter) {
  if (isBlank(value)) return { isSearch: false };
  await typeText(el, value);
  const isSearch = /学校名称/.test(ctx.label || '');
  if (pressEnter) await pressKey(el, 'Enter');
  await sleep(50);
  return { isSearch };
}

function findItem(list, value, level = 0) {
  const items = [];
  const texts = [];
  list.querySelectorAll(LIST_ITEM).forEach((item) => {
    if (isShown(item)) {
      items.push(item);
      texts.push((item.textContent || '').trim());
    }
  });
  let index = texts.indexOf(value);
  if (index === -1 && texts.length) {
    const path = splitPath(value);
    const best = pickOption(texts, path[Math.min(level, path.length - 1)] ?? value);
    index = best == null ? -1 : texts.indexOf(best);
  }
  return { total: list.querySelectorAll(LIST_ITEM).length, texts, item: index >= 0 ? items[index] : null };
}

// 地区项要点文字本身；带图标的普通项先点图标；多选项点复选框。
function clickItem(item) {
  const fire = (el) => !!el && (el.dispatchEvent(new MouseEvent('click', { bubbles: true })), true);
  const arrow = item.querySelector('.area-icon-right');
  const label = item.querySelector('.area-text-label');
  const icon = item.querySelector('.icon-container > svg');
  const checkbox = item.querySelector('.phoenix-checkbox');
  if (arrow && label) {
    if (icon) fire(icon);
    fire(label);
    return;
  }
  if (!(icon && fire(icon)) && !(checkbox && fire(checkbox))) item.click();
}

async function waitListChanged(layer, previous) {
  let list = null;
  await waitFor(
    () => {
      list = layer.querySelector(LIST);
      if (!list) return false;
      const now = Array.from(list.querySelectorAll(LIST_ITEM))
        .map((i) => (i.textContent || '').trim())
        .filter(Boolean)
        .join('|');
      return now.length > 0 && now !== previous;
    },
    15,
    150,
  );
  return list || layer.querySelector(LIST);
}

// 地区级联：最多四级，点到没有右箭头的一级为止，再点“确定”。
async function selectArea(layer, list, value) {
  let ok = true;
  for (let level = 0; level < 4 && list; level++) {
    const { total, texts, item } = findItem(list, value, level);
    if (!total || !item) {
      ok = false;
      break;
    }
    const hasNext = !!item.querySelector('.area-icon-right');
    clickItem(item);
    await sleep(150);
    if (!hasNext) break;
    list = await waitListChanged(layer, texts.join('|'));
    if (!list) {
      ok = false;
      break;
    }
  }
  const confirm = layer.querySelector(CONFIRM);
  if (confirm && isShown(confirm)) {
    confirm.click();
    await sleep(120);
  }
  await clickBlank(150);
  return ok;
}

async function phoenixInput(el, value, ctx) {
  if (isBlank(value)) return true;
  const id = el.getAttribute('data-af-id');
  const { isSearch } = await typeThenMaybeEnter(el, value, ctx, false);
  if (isSearch) {
    let layer = null;
    await waitFor(() => (layer = topLayer(el)) != null && (bindLayer(layer, id), true), 25, 100);
    layer = topLayer(el);
    if (layer) {
      bindLayer(layer, id);
      const list = layer.querySelector('.phoenix-selectList, .list-data-container');
      const items = list ? list.querySelectorAll('.phoenix-selectList__listItem, .list-item-container') : [];
      if (items.length) {
        const texts = Array.from(items).map(textOf);
        const best = pickOption(texts, value);
        const index = best == null ? -1 : texts.indexOf(best);
        if (index >= 0) {
          items[index].click();
          await sleep(50);
          await clickBlank(150);
          return true;
        }
      }
      await clickBlank(150);
    }
    await pressKey(el, 'Enter');
    await sleep(50);
  }
  await clickBlank(150);
  return true;
}

async function phoenixSelect(el, value, ctx) {
  if (isBlank(value)) return true;
  const id = el.getAttribute('data-af-id');
  el.focus();
  await sleep(50);
  el.click();
  await sleep(100);
  const opened = await waitFor(
    () => {
      const layer = topLayer();
      bindLayer(layer, id);
      return !!layer;
    },
    10,
    100,
  );
  const layer = opened ? topLayer(el) : null;
  const fallback = async () => {
    await typeThenMaybeEnter(el, value, ctx, true);
    await clickBlank(150);
    return true;
  };
  if (!layer) return fallback();

  await waitFor(() => !!layer.querySelector('.phoenix-date-picker'), 10, 100);
  const calendar = layer.querySelector('.phoenix-date-picker, .phoenix-calendar');
  if (calendar) {
    const ok = await pickDate({
      container: calendar,
      dateStr: value,
      yearPanelSelector: '[class^="phoenix-calendar-month-panel-year-select"], .phoenix-calendar-year-select',
      yearElementSelector: '[class^="phoenix-calendar-year-panel-year"], .phoenix-calendar-year-panel-year',
      yearFilterClasses: ['phoenix-calendar-year-panel-last-decade-cell', 'phoenix-calendar-year-panel-next-decade-cell'],
      decadeSelector: '[class^="phoenix-calendar-year-panel-decade-select"], .phoenix-calendar-year-panel-decade-select-content',
      nextDecadeBtn: '[class*="phoenix-calendar-year-panel-next-decade-btn"]',
      prevDecadeBtn: '[class*="phoenix-calendar-year-panel-prev-decade-btn"]',
      monthConfig: '.phoenix-calendar-month-select',
      monthElementSelector: '[class^="phoenix-calendar-month-panel-month"]',
      dayElementSelector: '[class*="phoenix-calendar-date"]',
      yearRetryTimes: 20,
    });
    if (!ok) return fallback();
    await clickBlank(150);
    return true;
  }

  const list = layer.querySelector(LIST);
  if (list) {
    const isArea = list.classList.contains('area-data-container') || !!list.querySelector('.area-item-name, .area-text-label, .area-icon-right, .area-breadcrumb');
    if (isArea) return selectArea(layer, list, value);
    const { total, item } = findItem(list, value);
    if (total > 0 && item) {
      clickItem(item);
      await sleep(100);
      const confirm = layer.querySelector(CONFIRM);
      if (confirm && isShown(confirm)) {
        confirm.click();
        await sleep(100);
      }
      await clickBlank(100);
      return true;
    }
  }
  return fallback();
}

const looksLikeDate = (el) =>
  (el.type || '').toLowerCase() === 'date' || /\bdate\b/i.test(typeof el.className === 'string' ? el.className : '') || /年|月|日|至|开始时间|结束时间/.test(el.placeholder || '');

// 北森页面的字段统一由此适配器处理，返回实际操作结果。
export async function beisenAdapter(el, value, ctx) {
  try {
    if (!isVisible(el)) return { handled: true, success: false };
    const cls = typeof el.className === 'string' ? el.className : '';
    if (cls.includes('phoenix-input__input')) return { handled: true, success: await phoenixInput(el, value, ctx) };
    if (cls.includes('phoenix-select__input')) return { handled: true, success: await phoenixSelect(el, value, ctx) };
    if (el instanceof HTMLSelectElement) {
      const option = Array.from(el.options).find((o) => textOf(o) === value || o.value === value);
      if (option) {
        el.value = option.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(100);
        await clickBlank(50);
        return { handled: true, success: true };
      }
      await typeThenMaybeEnter(el, value, ctx, true);
      return { handled: true, success: false };
    }
    if (el instanceof HTMLInputElement) {
      if (isBlank(value)) return { handled: true, success: true };
      if (looksLikeDate(el)) {
        if ((el.type || '').toLowerCase() === 'date') {
          await setValueWithEvents(el, value, 100);
        } else await typeThenMaybeEnter(el, value, ctx, true);
        await clickBlank(50);
        return { handled: true, success: true };
      }
      const options = await collectOptions(el, { site: ctx.site });
      if (options.length) {
        // 匹配不到时不选择候选项，并返回失败。
        const best = pickOption(options.map((o) => o.text), value);
        const hit = best && options.find((o) => o.text === best);
        if (hit) {
          hit.element.click();
          await sleep(100);
          await clickBlank(50);
          return { handled: true, success: true };
        }
      }
      await typeThenMaybeEnter(el, value, ctx, true);
      await clickBlank(50);
      return { handled: true, success: !options.length };
    }
    await typeThenMaybeEnter(el, value, ctx, true);
    return { handled: true, success: true };
  } catch {
    return { handled: true, success: false };
  } finally {
    await sleep(50);
  }
}
