// 调度入口：明确的组件或普通文本才写入，未知控件跳过。

import { isVisible, clickBlank, scrollIntoViewIfNeeded, elementByXPath, sleep } from './dom.js';
import { typeTextChunked, setValueWithEvents } from './input.js';
import { detectSite } from './sites.js';
import { clickMatchingOption } from './options.js';
import { antdAdapter } from './adapters/antd.js';
import { atsxAdapter } from './adapters/atsx.js';
import { elementAdapter } from './adapters/element.js';
import { iviewAdapter, mtdKumaAdapter } from './adapters/misc.js';
import { beisenAdapter } from './adapters/beisen.js';
import { mokaAdapter, feishuAdapter, zhilianAdapter } from './adapters/sites.js';
import { pickOption } from './match.js';

const COMPONENT_ADAPTERS = [antdAdapter, atsxAdapter, elementAdapter, iviewAdapter, mtdKumaAdapter];
const CHOICE_OWNER = '.ant-select,.ant-cascader,.ant-picker,.ant-calendar-picker,.el-select,.el-cascader,.el-date-editor,.ivu-select,.ivu-cascader,.ivu-date-picker,.atsx-select,.atsx-date-picker,.mtd-select,.mtd-date-picker,[role="combobox"]';
const SELECTED_TEXT = '.ant-select-selection-item,.ant-select-selection-selected-value,.atsx-select-selection-item,.atsx-select-selection-selected-value,.el-select__selected-item,.ivu-select-selected-value,.mtd-select-filter-label:not(.mtd-select-filter-hint),.mtd-select-selected-label,.mtd-select-selection-item';
const SEARCH_SELECT = '.mtd-select,.ant-select,.atsx-select';

function readbackMatches(el, value) {
  let actual;
  if (el instanceof HTMLSelectElement) actual = el.selectedOptions[0]?.textContent?.trim();
  else {
    const owner = el.closest(CHOICE_OWNER);
    const shown = owner?.querySelector(SELECTED_TEXT);
    actual = shown ? shown.textContent?.trim() : owner?.matches(SEARCH_SELECT) ? ''
      : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value.trim() : undefined;
  }
  if (actual == null || actual === '') return false;
  const date = (text) => String(text).replace(/^(\d{4})[./-](\d{1,2})(?:[./-](\d{1,2}))?$/, (_, year, month, day) => `${year}-${month.padStart(2, '0')}${day ? `-${day.padStart(2, '0')}` : ''}`);
  if (el.closest(CHOICE_OWNER) || el instanceof HTMLSelectElement) {
    return date(actual) === date(value) || pickOption([actual], value, { strict: true }) === actual;
  }
  return actual === String(value).trim();
}

async function verified(el, value, success) {
  await clickBlank();
  await sleep(100);
  return success && el.isConnected && readbackMatches(el, value) ? 'filled' : 'failed';
}

async function nativeDateAdapter(el, value) {
  if (!(el instanceof HTMLInputElement) || (el.type || '').toLowerCase() !== 'date') return { handled: false, success: false };
  await setValueWithEvents(el, value, 100);
  return { handled: true, success: true };
}

function siteAdapterFor(site) {
  if (site?.kind === 'beisen') return beisenAdapter;
  if (site?.kind === 'moka') return mokaAdapter;
  const host = location.hostname;
  if (host.includes('jobs.bytedance.com') || host.includes('feishu.cn')) return feishuAdapter;
  if (host.includes('zhaopin.com')) return zhilianAdapter;
  return null;
}

// 只要年份或月份的输入框（看 placeholder），从完整日期里截取对应部分。
function adaptDateForPlaceholder(el, value) {
  if (!(el instanceof HTMLInputElement)) return value;
  const placeholder = (el.getAttribute('placeholder') || '').trim();
  const m = String(value ?? '').trim().match(/^(\d{4})(?:[-/.]|年)(\d{1,2})(?:[-/.]|月)(\d{1,2})(?:日)?$/);
  if (!m) return value;
  if (placeholder.includes('年') && !placeholder.includes('月')) return m[1];
  if (placeholder.includes('月') && !placeholder.includes('年')) return String(Number(m[2]));
  return value;
}

function isDisabled(el) {
  return el.disabled || el.classList.contains('ant-input-disabled') || !!el.closest('[aria-disabled="true"],.mtd-select-disabled,.ant-select-disabled,.el-select.is-disabled');
}

/**
 * 填写单个字段。
 * @param {Element} el
 * @param {string} value 日期统一用 YYYY-MM-DD 或 YYYY-MM；级联用“一级/二级/三级”。
 * @param {{ label?: string, site?: object | null }} [ctx]
 * @returns {Promise<'filled' | 'failed' | 'skipped'>}
 */
export async function fillField(el, value, ctx = {}) {
  if (value == null || !String(value).trim()) return 'skipped';
  if (!el || isDisabled(el) || !isVisible(el)) return 'skipped';
  const context = { label: ctx.label || el.getAttribute('data-af-label') || '', site: ctx.site ?? detectSite() };
  const originalSearch = el instanceof HTMLInputElement && el.closest(SEARCH_SELECT) ? el.value : null;
  const verify = async (success) => {
    const result = await verified(el, value, success);
    if (result === 'failed' && originalSearch != null && el.value !== originalSearch) await setValueWithEvents(el, originalSearch, 0);
    return result;
  };
  try {
    await scrollIntoViewIfNeeded(el);
    if (el instanceof HTMLSelectElement) {
      const options = Array.from(el.options).filter((o) => !o.disabled && o.value).map((o) => ({ text: o.textContent.trim(), element: o }));
      return await verified(el, value, await clickMatchingOption(el, options, value));
    }
    for (const adapter of [...COMPONENT_ADAPTERS, nativeDateAdapter]) {
      const r = await adapter(el, value, context);
      if (r.handled) return r.skipped ? 'skipped' : await verify(r.success);
    }
    // 普通可编辑文本框是明确的控件，写入后读回即可；不去点击其他字段残留的下拉。
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
      && !el.readOnly && !el.closest(CHOICE_OWNER)
      && !/^请?选择/.test(el.getAttribute('placeholder') || '') && el.getAttribute('aria-autocomplete') !== 'list') {
      await typeTextChunked(el, adaptDateForPlaceholder(el, value));
      return await verified(el, adaptDateForPlaceholder(el, value), true);
    }
    let r = { handled: false, success: false };
    const siteAdapter = siteAdapterFor(context.site);
    if (siteAdapter) r = await siteAdapter(el, value, context);
    if (r.success) return await verified(el, value, true);
    if (r.handled) return 'failed';
    // 不认识的自定义控件不使用文本兜底，以免只写入搜索词。
    return 'skipped';
  } catch {
    return 'failed';
  }
}

/**
 * 按顺序填写一组字段。日期区间的开始、结束两个输入框必须相邻且先开始后结束。
 * 命中 delayFillSelector 的字段（如“证件号码类型”依赖前面的“国籍”）推迟到最后，并倒序填写。
 * @param {{ element?: Element, xpath?: string, value: string, label?: string }[]} fields
 * @param {{ site?: object | null, delayFillSelector?: string | string[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal, shouldFill?: (element: Element) => boolean }} [opts]
 */
export async function fillAll(fields, opts = {}) {
  const site = opts.site ?? detectSite();
  const delaySelectors = [opts.delayFillSelector ?? site?.delay_fill_selector ?? []]
    .flat()
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  const total = fields.filter((f) => f.value != null && String(f.value).trim()).length;
  const results = new Array(fields.length).fill('skipped');
  const deferred = [];
  let done = 0;

  fields.forEach((f, i) => {
    const el = f.element ?? (f.xpath ? elementByXPath(f.xpath) : null);
    if (!el) return;
    el.setAttribute('data-af-id', String(i + 1));
    if (f.label) el.setAttribute('data-af-label', f.label);
  });

  const run = async (f, i) => {
    const el = f.element ?? (f.xpath ? elementByXPath(f.xpath) : null);
    if (!el?.isConnected || opts.signal?.aborted) return;
    if (opts.shouldFill && !opts.shouldFill(el)) { results[i] = 'kept'; return; }
    results[i] = await fillField(el, f.value, { label: f.label, site });
    if (results[i] === 'filled' || results[i] === 'typed') opts.onProgress?.(++done, total);
    await clickBlank();
  };

  opts.onProgress?.(0, total);
  for (let i = 0; i < fields.length; i++) {
    if (opts.signal?.aborted) break;
    const f = fields[i];
    const el = f.element ?? (f.xpath ? elementByXPath(f.xpath) : null);
    if (el && delaySelectors.some((s) => el.matches(s))) {
      deferred.push([f, i]);
      continue;
    }
    await run(f, i);
  }
  for (const [f, i] of deferred.reverse()) {
    if (opts.signal?.aborted) break;
    await run(f, i);
  }
  return results;
}
