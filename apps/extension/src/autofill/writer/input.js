// 文本写入：原生 setter 赋值、整段填写、逐字符模拟和按键。

import { sleep } from './dom.js';

// React/Vue 受控组件会拦截实例上的 value 赋值，必须调用原型上的原生 setter 才能让框架感知变化。
export function setNativeValue(el, value) {
  try {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  } catch {}
}

// 直接赋值并派发 input/change，用于搜索框触发联想。
export async function setValueWithEvents(el, value, waitAfter = 20) {
  setNativeValue(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(waitAfter);
}

const norm = (v) => String(v ?? '').trim();

// 原生 select：按 value 再按文本匹配，多选值支持顿号、逗号、分号或换行分隔。
async function fillNativeSelect(select, text) {
  const options = Array.from(select.options || []);
  try {
    select.dispatchEvent(new Event('focus'));
  } catch {}
  await sleep(10);
  if (!options.length) return;
  const indexOf = (v) => {
    const t = norm(v);
    if (!t) return -1;
    const byValue = options.findIndex((o) => norm(o.value) === t);
    return byValue !== -1 ? byValue : options.findIndex((o) => norm(o.textContent) === t);
  };
  const wanted = select.multiple
    ? String(text ?? '').split(/[、,，;；\n\r]+/).map((s) => s.trim()).filter(Boolean)
    : [norm(text)];
  const hits = new Set(wanted.map(indexOf).filter((i) => i !== -1));
  if (select.multiple) {
    options.forEach((o, i) => {
      o.selected = hits.has(i);
    });
  } else {
    const index = hits.size ? [...hits][0] : -1;
    if (index !== -1) select.selectedIndex = index;
    else if (text && select.value !== text) select.value = text;
  }
  try {
    select.setAttribute('value', text);
  } catch {}
  try {
    select.dispatchEvent(new Event('input', { bubbles: true }));
  } catch {}
  try {
    select.dispatchEvent(new Event('blur'));
  } catch {}
}

const TEXT_TYPES = new Set(['', 'email', 'number', 'password', 'search', 'tel', 'text', 'url']);
const PICKER_TYPES = new Set(['color', 'date', 'time', 'datetime-local', 'month', 'range', 'week']);

async function typeCharByChar(el, text, delay) {
  const tag = el.tagName?.toLowerCase() || '';
  const isField = tag === 'input' || tag === 'textarea';
  const isEditable = !isField && el.isContentEditable;
  if (isField) {
    setNativeValue(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (isEditable) el.textContent = '';
  await sleep(10);
  for (let i = 0; i < text.length; i++) {
    const key = text[i];
    const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
    el.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, composed: true }));
    el.dispatchEvent(new KeyboardEvent('keypress', { key, code, bubbles: true, cancelable: true }));
    if (isField) setNativeValue(el, text.substring(0, i + 1));
    else if (isEditable) el.textContent = text.substring(0, i + 1);
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true }));
    if (delay > 0) await sleep(delay);
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// 先全选已有内容再整体替换，模拟粘贴。
async function replaceAll(el, text) {
  const tag = el.tagName?.toLowerCase() || '';
  const isInput = tag === 'input';
  const isTextarea = tag === 'textarea';
  const isEditable = !isInput && !isTextarea && el.isContentEditable;
  if (isInput) {
    try {
      el.select();
    } catch {
      try {
        el.setSelectionRange(0, el.value.length);
      } catch {}
    }
  } else if (isTextarea) {
    el.selectionStart = 0;
    el.selectionEnd = el.value.length;
  } else if (isEditable) {
    try {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      const sel = el.ownerDocument.defaultView?.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {}
  }
  await sleep(5);
  if (isInput || isTextarea) setNativeValue(el, text);
  else if (isEditable) el.textContent = text;
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * 向输入类元素写入文本。
 * @param {Element} el
 * @param {string} text
 * @param {{ simulate?: boolean, delay?: number }} [opts] simulate 为 true 时逐字符派发键盘事件。
 */
export async function typeText(el, text, { simulate = false, delay = 5 } = {}) {
  if (!el) return;
  text = text ?? '';
  try {
    if (el instanceof HTMLSelectElement) return await fillNativeSelect(el, text);
    const tag = el.tagName?.toLowerCase() || '';
    if (tag === 'input') {
      const type = (el.type || '').toLowerCase();
      if (!TEXT_TYPES.has(type) && !PICKER_TYPES.has(type)) return;
      if (type === 'number' && text.trim() && isNaN(Number(text.trim()))) return;
      if (PICKER_TYPES.has(type)) {
        el.focus();
        setNativeValue(el, text.trim());
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
    const isField = tag === 'input' || tag === 'textarea';
    if (!isField && !el.isContentEditable) return;
    try {
      el.focus();
      el.focus();
      await sleep(5);
    } catch {}
    if (simulate) await typeCharByChar(el, text, delay);
    else await replaceAll(el, text);
    await sleep(20);
  } catch {}
}

// 超过 30 字的长文本先写前 30 字再写全文，部分组件只在首次输入后才放开 maxlength 或自适应高度。
export async function typeTextChunked(el, text) {
  if (!text) return;
  if (text.length > 30) {
    await typeText(el, text.slice(0, 30));
    await sleep(10);
  }
  await typeText(el, text);
  await sleep(50);
}

const NAMED_KEYS = {
  Enter: [13, 'Enter', 'Enter'],
  Escape: [27, 'Escape', 'Escape'],
  Tab: [9, 'Tab', 'Tab'],
  Backspace: [8, 'Backspace', 'Backspace'],
  Delete: [46, 'Delete', 'Delete'],
  ArrowUp: [38, 'ArrowUp', 'ArrowUp'],
  ArrowDown: [40, 'ArrowDown', 'ArrowDown'],
  ArrowLeft: [37, 'ArrowLeft', 'ArrowLeft'],
  ArrowRight: [39, 'ArrowRight', 'ArrowRight'],
  Home: [36, 'Home', 'Home'],
  End: [35, 'End', 'End'],
  Space: [32, 'Space', ' '],
};
const MODIFIERS = {
  Control: [17, 'ControlLeft', 'Control'],
  Meta: [91, 'MetaLeft', 'Meta'],
  Alt: [18, 'AltLeft', 'Alt'],
  Shift: [16, 'ShiftLeft', 'Shift'],
};

function keyInit([keyCode, code, key], flags) {
  return { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, ...flags };
}

// 支持组合键写法，如 "Enter"、"Control+a"。
export async function pressKey(el, combo, { delay = 0 } = {}) {
  if (!el) return;
  try {
    el.focus?.();
  } catch {}
  const parts = combo.split('+').map((s) => s.trim());
  const mods = parts.slice(0, -1);
  const last = parts[parts.length - 1];
  const main = NAMED_KEYS[last] ?? [last.length === 1 ? last.toUpperCase().charCodeAt(0) : 0, last.length === 1 ? `Key${last.toUpperCase()}` : last, last];
  const flags = {
    ctrlKey: mods.includes('Control'),
    metaKey: mods.includes('Meta'),
    altKey: mods.includes('Alt'),
    shiftKey: mods.includes('Shift'),
  };
  for (const m of mods) if (MODIFIERS[m]) el.dispatchEvent(new KeyboardEvent('keydown', keyInit(MODIFIERS[m], flags)));
  el.dispatchEvent(new KeyboardEvent('keydown', keyInit(main, flags)));
  el.dispatchEvent(new KeyboardEvent('keypress', keyInit(main, flags)));
  if (delay) await sleep(delay);
  el.dispatchEvent(new KeyboardEvent('keyup', keyInit(main, flags)));
  for (const m of [...mods].reverse()) if (MODIFIERS[m]) el.dispatchEvent(new KeyboardEvent('keyup', keyInit(MODIFIERS[m], flags)));
}
