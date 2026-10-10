// 页面字段扫描：找出可填写的控件，并整理出给决策层的上下文。只读取页面结构，不读取简历。
import { isVisible } from '../writer/dom.js';
import type { SiteConfig } from '../writer/types';

export interface ScannedField {
  uid: string;
  section: string;
  label: string;
  placeholder: string;
  kind: string;
  options: string[];
  /** 是否为下拉/选择类控件；只允许单个明确值，不能擅取数组第一项。 */
  isChoice: boolean;
  /** 位于站点配置的经历容器中时，表示同一模块内第几个容器。 */
  group: number | null;
  /** 控件当前已有值。 */
  hasValue: boolean;
  /** 多选控件不能擅自从多个资料值中选择第一项。 */
  isMultiple?: boolean;
}

const SKIP_INPUT_TYPES = new Set(['hidden', 'radio', 'checkbox', 'file', 'submit', 'button', 'image', 'reset', 'password']);
const CUSTOM_SELECTS =
  '.ant-select, .atsx-select, .kuma-select2, hc-super-selector, .ivu-select, .ui-select, .select-input, .el-dropdown, .brick-select';
const CHOICE_OWNERS =
  '.ant-select, .ant-cascader, .ant-picker, .ant-calendar-picker, .el-select, .el-cascader, .el-date-editor, .ivu-select, .ivu-cascader, .ivu-date-picker, .atsx-select, .atsx-date-picker, .mtd-select, .mtd-date-picker, .ud__select, .ud__picker-dateInput, [class*="sd-Dropdown-container"], [role="combobox"]';
const SELECT_OWNERS = '.ant-select,.el-select,.ivu-select,.atsx-select,.mtd-select,[role="combobox"]';
const SKIP_LABEL = /验证码|captcha|verification code|密码|password/i;
const HEADING =
  'h1,h2,h3,h4,h5,legend,[role="heading"],[class*="title" i]:not(input):not(textarea),[class*="header" i]:not(input):not(textarea)';

const FIELD_WRAPPER = 'label, [class*="form-item" i], [class*="formitem" i], [class*="field-item" i]';

export function cleanText(text: string | null | undefined) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[*＊]/g, '')
    .replace(/[:：]\s*$/, '')
    .replace(/[（(](选填|必填|可选)[)）]/g, '')
    .trim();
}

function ownText(el: Element) {
  return cleanText(
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join(''),
  );
}

const hasControl = (el: Element) => !!el.querySelector('input,select,textarea');

function collectControls(site: SiteConfig | null): HTMLElement[] {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter((i) => !SKIP_INPUT_TYPES.has((i.type || 'text').toLowerCase()));
  const selects = Array.from(document.querySelectorAll<HTMLSelectElement>('select'));
  const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea'));
  const customSelector = site?.selectElements ? `${CUSTOM_SELECTS}, ${site.selectElements}` : CUSTOM_SELECTS;
  // 自定义下拉只有在内部输入框都不可见时才把容器本身当作控件，否则用内部输入框。
  const customs = Array.from(document.querySelectorAll<HTMLElement>(customSelector)).filter((box) => {
    const inner = box.querySelectorAll('input');
    return inner.length === 0 || Array.from(inner).every((i) => !isVisible(i));
  });
  const all = [...inputs, ...selects, ...textareas, ...customs].filter((el) => {
    if (!isVisible(el)) return false;
    // 只读输入框通常是下拉或日历的显示框，只有不属于这类组件时才跳过
    if ((el as HTMLInputElement).disabled || (el.hasAttribute('readonly') && !el.closest(CHOICE_OWNERS))) return false;
    // 自定义下拉容器嵌套时只保留最外层
    if (customs.includes(el) && customs.some((c) => c !== el && c.contains(el))) return false;
    return true;
  });
  return all.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

function labelByConfig(el: Element, level2: string): string {
  const boundary = el.closest(FIELD_WRAPPER);
  let node: Element | null = el;
  for (let i = 0; i < 15 && node; i++) {
    node = node.parentElement;
    if (!node) break;
    const found = node.querySelectorAll(level2);
    if (found.length) {
      // 取文档顺序上位于控件之前的最后一个标签
      let best: Element | null = null;
      for (const f of found) {
        if (f.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = f;
      }
      return best ? cleanText(best.textContent) : '';
    }
    // 不跨表单项查找标签，否则页面顶部的控件会借用后面的“姓名”。
    if (node === boundary || node === document.body || node.matches('form,[role="form"]')) break;
  }
  return '';
}

function labelOf(el: HTMLElement, site: SiteConfig | null): string {
  if (el.id) {
    const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (l && cleanText(l.textContent)) return cleanText(l.textContent);
  }
  const wrap = el.closest('label');
  if (wrap) {
    const t = ownText(wrap) || cleanText(wrap.textContent);
    if (t) return t;
  }
  const aria = el.getAttribute('aria-label');
  if (aria) return cleanText(aria);
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = cleanText(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(' '));
    if (t) return t;
  }
  if (site?.level2_class) {
    try {
      const t = labelByConfig(el, site.level2_class);
      if (t) return t;
    } catch {}
  }
  const boundary = el.closest(FIELD_WRAPPER);
  let node: Element | null = el;
  for (let i = 0; i < 12 && node; i++) {
    node = node.parentElement;
    if (!node || node === document.body) break;
    const cand = Array.from(node.querySelectorAll('label,th,dt,[class*="label" i]')).find(
      (c) => !c.contains(el) && !hasControl(c) && cleanText(c.textContent)
        && !!(c.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
    );
    if (cand) return cleanText(cand.textContent);
    const prev = node.previousElementSibling;
    const prevText = prev && !hasControl(prev) ? cleanText(prev.textContent) : '';
    if (prevText && prevText.length <= 30) return prevText;
    if (node === boundary || node.matches('form,[role="form"]')) break;
  }
  return '';
}

function sectionOf(el: Element, site: SiteConfig | null, headings: Element[]): string {
  if (site?.level1_class) {
    try {
      const top = el.getBoundingClientRect().top;
      let best = '';
      document.querySelectorAll(site.level1_class).forEach((h) => {
        if (h.getBoundingClientRect().top <= top) best = cleanText(h.textContent);
      });
      if (best) return best;
    } catch {}
  }
  let best = '';
  for (const h of headings) {
    if (h.contains(el)) continue;
    if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      const t = cleanText(h.textContent);
      if (t && t.length <= 40) best = t;
    } else break;
  }
  return best;
}

function kindOf(el: HTMLElement) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag !== 'input') return 'custom-select';
  if (el.closest(SELECT_OWNERS)) return 'custom-select';
  return `input:${((el as HTMLInputElement).type || 'text').toLowerCase()}`;
}

export function currentValue(el: HTMLElement): string {
  if (el instanceof HTMLSelectElement) {
    const opt = el.selectedOptions[0];
    return opt && opt.value ? cleanText(opt.textContent) : '';
  }
  const root = el.closest(SELECT_OWNERS) ?? el;
  const shown = root.querySelector('.ant-select-selection-item, .ant-select-selection-selected-value, .el-select__selected-item, .ivu-select-selected-value, .mtd-select-filter-label:not(.mtd-select-filter-hint)');
  if (shown && cleanText(shown.textContent)) return cleanText(shown.textContent);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.trim();
  return shown ? cleanText(shown.textContent) : '';
}

function groupIndex(el: Element, site: SiteConfig | null, sectionTitle: string, sectionCache: Map<Element, string>, headings: Element[]) {
  if (!site?.group_class) return null;
  try {
    const box = el.closest(site.group_class);
    if (!box) return null;
    const siblings = Array.from(document.querySelectorAll(site.group_class)).filter((g) => {
      if (!sectionCache.has(g)) sectionCache.set(g, sectionOf(g, site, headings));
      return sectionCache.get(g) === sectionTitle;
    });
    const i = siblings.indexOf(box);
    return i >= 0 ? i : null;
  } catch {
    return null;
  }
}

let uidSeq = 0;

export function scanPage(site: SiteConfig | null): ScannedField[] {
  // 字段标签的类名里也常带 title，位于表单项容器内的不算模块标题
  const headings = Array.from(document.querySelectorAll(HEADING)).filter(
    (h) => !hasControl(h) && !h.closest(FIELD_WRAPPER) && isVisible(h),
  );
  const sectionCache = new Map<Element, string>();
  const fields: ScannedField[] = [];
  for (const el of collectControls(site)) {
    let label = labelOf(el, site);
    const choiceOwner = el.closest(CHOICE_OWNERS);
    const placeholder = cleanText(el.getAttribute('placeholder')) || cleanText(
      choiceOwner?.querySelector('[class*="placeholder"],.mtd-select-filter-hint')?.textContent,
    );
    // 证件类型与号码共用一个表单标签时，用选择器自身明确的提示区分它们。
    if (choiceOwner && label === '证件号码' && placeholder === '请选择证件类型') label = '证件类型';
    if (SKIP_LABEL.test(label) || SKIP_LABEL.test(placeholder)) continue;
    const section = sectionOf(el, site, headings);
    let uid = el.getAttribute('data-af-uid');
    if (!uid) {
      uid = `f${++uidSeq}`;
      el.setAttribute('data-af-uid', uid);
    }
    const options =
      el instanceof HTMLSelectElement
        ? Array.from(el.options)
            .map((o) => cleanText(o.textContent))
            .filter((t) => t && !/^(请选择|--|select)/i.test(t))
            .slice(0, 8)
        : [];
    const kind = kindOf(el);
    fields.push({
      uid,
      section,
      label,
      placeholder,
      kind,
      options,
      isChoice: kind === 'select' || kind === 'custom-select' || !!el.closest(CHOICE_OWNERS) || /^请?选择/.test(placeholder),
      group: groupIndex(el, site, section, sectionCache, headings),
      hasValue: !!currentValue(el),
      isMultiple: !!((el as HTMLSelectElement).multiple || choiceOwner?.matches('[aria-multiselectable="true"],[class*="multiple"]')),
    });
  }
  return fields;
}

export function elementByUid(uid: string): HTMLElement | null {
  return document.querySelector(`[data-af-uid="${CSS.escape(uid)}"]`);
}
