// 调度入口：按组件库逐个尝试适配器，最后用直接输入兜底。

import { isVisible, clickBlank, scrollIntoViewIfNeeded, elementByXPath } from './dom.js';
import { typeTextChunked, setValueWithEvents } from './input.js';
import { detectSite } from './sites.js';
import { selectFromPopup } from './options.js';
import { antdAdapter } from './adapters/antd.js';
import { atsxAdapter } from './adapters/atsx.js';
import { elementAdapter } from './adapters/element.js';
import { iviewAdapter, mtdKumaAdapter } from './adapters/misc.js';
import { beisenAdapter } from './adapters/beisen.js';
import { mokaAdapter, feishuAdapter, zhilianAdapter } from './adapters/sites.js';

const COMPONENT_ADAPTERS = [antdAdapter, atsxAdapter, elementAdapter, iviewAdapter, mtdKumaAdapter];

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
  return el instanceof HTMLInputElement && (el.disabled || el.classList.contains('ant-input-disabled'));
}

/**
 * 填写单个字段。
 * @param {Element} el
 * @param {string} value 日期统一用 YYYY-MM-DD 或 YYYY-MM；级联用“一级/二级/三级”。
 * @param {{ label?: string, site?: object | null }} [ctx]
 * @returns {Promise<'filled' | 'typed' | 'failed' | 'skipped'>}
 *   typed 表示没有识别出组件，按普通文本输入写入，需要人工复核。
 */
export async function fillField(el, value, ctx = {}) {
  if (value == null || !String(value).trim()) return 'skipped';
  if (!el || isDisabled(el) || !isVisible(el)) return 'skipped';
  const context = { label: ctx.label || el.getAttribute('data-af-label') || '', site: ctx.site ?? detectSite() };
  try {
    await scrollIntoViewIfNeeded(el);
    for (const adapter of [...COMPONENT_ADAPTERS, nativeDateAdapter]) {
      const r = await adapter(el, value, context);
      if (r.handled) return r.success ? 'filled' : 'failed';
    }
    let r = { handled: false, success: false };
    const siteAdapter = siteAdapterFor(context.site);
    if (siteAdapter) r = await siteAdapter(el, value, context);
    if (!r.handled) r = await selectFromPopup(el, value, { label: context.label, site: context.site });
    if (r.success) return 'filled';
    if (r.handled) return 'failed';
    await typeTextChunked(el, adaptDateForPlaceholder(el, value));
    await clickBlank();
    return 'typed';
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
