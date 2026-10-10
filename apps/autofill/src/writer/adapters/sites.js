// 站点专用模式：Moka（sd-* 组件）、飞书招聘/字节（ud__* 组件）、智联（s-cascader 弹窗）。

import { sleep, textOf, realClick, clickBlank, scrollIntoViewIfNeeded } from '../dom.js';
import { typeText, typeTextChunked, pressKey } from '../input.js';
import { pickOption, splitPath } from '../match.js';
import { pickDateWithPreset } from '../calendar.js';
import { optionsIn, selectFromPopupStrict } from '../options.js';

// ---------- Moka ----------

function mokaPopup(el) {
  const box = el.closest('[class*="sd-Dropdown-container"]');
  if (!box) return null;
  return box.querySelector('[class*="sd-Dropdown-dropdown"]') || box.querySelector('[class*="sd-Select-menu"]');
}

const mokaOptions = (popup) => optionsIn(popup, '[class*="sd-Menu-content-item"]');

async function pollFor(get, times, interval) {
  for (let i = 0; i < times; i++) {
    const v = get();
    if (v && (!Array.isArray(v) || v.length)) return v;
    await sleep(interval);
  }
  return null;
}

export async function mokaAdapter(el, value) {
  const box = el.closest('[class*="sd-Dropdown-container"]');
  if (!box) {
    await typeTextChunked(el, value);
    return { handled: true, success: true };
  }
  try {
    await realClick(el, 100);
  } catch {}
  try {
    let popup = mokaPopup(el);
    const datePanel = popup?.querySelector('[class*="sd-panal-menu-wrapper"]');
    if (datePanel) {
      const ok = await pickDateWithPreset('moka', datePanel, value);
      await sleep(20);
      await clickBlank(100);
      return { handled: true, success: ok };
    }
    let options = popup ? mokaOptions(popup) : [];
    // 可搜索下拉：先输入原文触发搜索，再等浮层和选项出现。
    if (!popup || !options.length) {
      await typeTextChunked(el, value);
      popup = await pollFor(() => mokaPopup(el), 50, 50);
      if (!popup) return { handled: true, success: false };
      options = (await pollFor(() => mokaOptions(popup), 20, 100)) || [];
      if (!options.length) return { handled: true, success: false };
    }
    const exact = options.find((o) => o.text === value);
    if (exact) {
      exact.element.click();
      await sleep(80);
      return { handled: true, success: true };
    }
    // 匹配到近似项后把它的原文输入搜索框，再回车选中。
    const best = pickOption(options.map((o) => o.text), value);
    if (!best) return { handled: true, success: false };
    try {
      await typeText(el, best);
      await sleep(50);
      await pressKey(el, 'Enter');
      await sleep(50);
    } catch {
      await typeTextChunked(el, value);
    }
    return { handled: true, success: true };
  } catch {
    return { handled: true, success: false };
  } finally {
    await clickBlank(50);
  }
}

// ---------- 飞书招聘 / 字节 ----------

export async function feishuAdapter(el, value, ctx) {
  try {
    if (el.closest('.ud__select')) {
      return selectFromPopupStrict(el, value, { site: ctx.site, searchable: /学校/.test(ctx.label || '') });
    }
    const isDate = !!el.closest('.ud__picker-dateInput');
    const isRange = !!el.closest('.throne-biz-date-range-picker-input');
    if (!isDate && !isRange) return { handled: false, success: false };
    let ok = false;
    try {
      await realClick(el, isDate ? 0 : 100);
      const panel = document.querySelector('.ud__picker-date-panel, .ud__picker-dropdown');
      ok = !!panel && (await pickDateWithPreset('feishu', panel, value));
    } catch {}
    await clickBlank();
    return { handled: true, success: ok };
  } catch {
    await clickBlank();
    return { handled: true, success: false };
  }
}

// ---------- 智联 ----------

const ZL_ITEM = '.s-cascader__option, .s-cascader__select-option, .s-checkbutton__item';
const zlDialog = () => document.querySelector('.s-dialog__wrapper:not([style*="display: none"]), .s-dialog__overlay:not([style*="display: none"])');

async function closeZlDialog(dialog) {
  const close = dialog?.querySelector('.s-icon-guanbi');
  if (close) await realClick(close, 100);
}

// 第一列若有“热门”分组，先展开热门，把热门项和普通项合在一起匹配。
async function pickInColumn({ column, cascader, target, isFirstLevel }) {
  const items = Array.from(column.querySelectorAll(ZL_ITEM));
  const texts = items.map(textOf);
  let hotItems = [];
  let hotTexts = [];
  if (isFirstLevel && texts.includes('热门')) {
    items[texts.indexOf('热门')].click();
    await sleep(80);
    const scrollbars = cascader.querySelectorAll('.s-scrollbar');
    hotItems = scrollbars.length > 1 ? Array.from(scrollbars[1].querySelectorAll(ZL_ITEM)) : Array.from(cascader.querySelectorAll('.s-cascader-horizontal-list li'));
    hotTexts = hotItems.map(textOf);
  }
  const all = texts.concat(hotTexts);
  if (!all.length) return false;
  let index = all.indexOf(target);
  if (index === -1) {
    const best = pickOption(all, target);
    index = best == null ? -1 : all.indexOf(best);
  }
  if (index === -1) return false;
  const hit = index < items.length ? items[index] : hotItems[index - items.length];
  if (!hit) return false;
  await realClick(hit, 100);
  return true;
}

// 智联的地区、行业等字段点击后弹出多列选择对话框，值按“/、-、空格”拆成逐级路径。
export async function zhilianAdapter(el, value) {
  if (!el.closest('.el-input')) return { handled: false, success: false };
  const path = splitPath(value);
  if (!path.length) return { handled: false, success: false };
  try {
    await scrollIntoViewIfNeeded(el);
    await realClick(el);
    await sleep(80);
    const dialog = zlDialog();
    const cascader = dialog?.querySelector('.s-cascader');
    if (!cascader) {
      await closeZlDialog(dialog);
      return { handled: false, success: false };
    }
    const columns = Array.from(cascader.querySelectorAll('.s-scrollbar'));
    if (!columns.length) {
      await closeZlDialog(dialog);
      return { handled: true, success: false };
    }
    let ok = false;
    for (let i = 0; i < columns.length; i++) {
      ok = await pickInColumn({ column: columns[i], cascader, target: path[i] || path[path.length - 1], isFirstLevel: i === 0 });
      if (!ok) break;
      await sleep(60);
    }
    // 选择失败时点“确定”保留已选部分并关闭对话框；成功时对话框会自动关闭。
    if (!ok) {
      const footer = cascader.querySelector('.s-cascader__footer');
      footer?.querySelectorAll('.s-cascader__footer-button').forEach((b) => {
        const t = textOf(b).replace(/\s+/g, '');
        if (t.includes('确定') || t.includes('确认')) b.click();
      });
      await sleep(80);
      await closeZlDialog(dialog);
    }
    return { handled: true, success: ok };
  } catch {
    await closeZlDialog(zlDialog());
    return { handled: true, success: false };
  }
}
