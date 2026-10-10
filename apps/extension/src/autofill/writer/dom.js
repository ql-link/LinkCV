// DOM 基础工具：可见性、查询、真实点击、滚动与轮询。

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function textOf(el) {
  return (el?.textContent ?? '').trim();
}

function classNameOf(el) {
  return typeof el?.className === 'string' ? el.className : '';
}

// 逐级检查祖先的 display/visibility/opacity，再排除零尺寸和过渡中的离场元素。
export function isVisible(el) {
  if (!el) return false;
  for (let node = el; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const cls = classNameOf(el);
  return !['hidden', 'hide', '-leave', '-leave-active', '-exit'].some((k) => cls.includes(k));
}

export function queryAllVisible(selector, root = document) {
  return Array.from(root.querySelectorAll(selector)).filter(isVisible);
}

export function queryVisible(selector, root = document) {
  return queryAllVisible(selector, root)[0] ?? null;
}

const BARE_CLASS = /^[A-Za-z_-][A-Za-z0-9_-]*$/;

// closest 的宽松版：允许传入不带点的裸类名，命中 body 视为未命中。
export function closestOf(el, selector) {
  if (!el) return null;
  try {
    const hit = el.closest(selector);
    if (hit) return hit === document.body ? null : hit;
  } catch {}
  if (!selector.includes('.') && BARE_CLASS.test(selector)) {
    try {
      const hit = el.closest(`.${selector}`);
      return hit === document.body ? null : hit;
    } catch {}
  }
  return null;
}

export function findIn(el, selector) {
  try {
    let hit = el.querySelector(selector);
    if (hit == null && BARE_CLASS.test(selector)) hit = el.querySelector(`.${selector}`);
    return hit;
  } catch {
    return null;
  }
}

// 按真实用户顺序派发 pointerdown → mousedown → mouseup → click，坐标取元素中心。
// 很多组件只监听 pointerdown 或 mousedown 来展开浮层，只调 el.click() 打不开。
export async function realClick(el, waitAfter = 0) {
  const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
  const x = rect.left + Math.max(0, rect.width) / 2;
  const y = rect.top + Math.max(0, rect.height) / 2;
  try {
    el.focus?.();
  } catch {}
  const init = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button: 0,
    buttons: 1,
  };
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', init));
  } catch {
    el.dispatchEvent(new MouseEvent('mousedown', init));
  }
  await sleep(12);
  el.dispatchEvent(new MouseEvent('mousedown', init));
  await sleep(12);
  el.dispatchEvent(new MouseEvent('mouseup', init));
  await sleep(12);
  el.dispatchEvent(new MouseEvent('click', init));
  await sleep(waitAfter > 0 ? waitAfter : 20);
}

// 点击页面空白处，用来收起上一个字段残留的下拉或日历浮层。
export function clickBlank(waitAfter = 100) {
  return realClick(document.body, waitAfter);
}

export function dispatchBlur(el) {
  el.dispatchEvent(new Event('blur'));
}

// 元素落在视口下方 25% 区域或超出视口时，平滑滚动到视口上方约 25% 的位置。
export async function scrollIntoViewIfNeeded(el, opts = {}) {
  if (!el || !document.body.contains(el)) return;
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  if (!viewport) return;
  const rect = el.getBoundingClientRect();
  const clamp = (v) => Math.min(Math.max(v, 0), 1);
  const trigger = viewport * clamp(opts.triggerRatio ?? 0.75);
  if (!(rect.top > trigger || rect.bottom > viewport)) return;
  const target = Math.max(0, window.scrollY + rect.top - viewport * clamp(opts.targetRatio ?? 0.25) - (opts.extraOffset ?? 0));
  if (Math.abs(target - window.scrollY) < 1) return;
  window.scrollTo({ top: target, behavior: 'smooth' });
  await sleep(200);
}

export async function waitFor(check, times = 10, interval = 100) {
  for (let i = 0; i < times; i++) {
    if (await check()) return true;
    await sleep(interval);
  }
  return false;
}

// 页面上同时存在多个同类浮层时，取离触发元素左下角最近的那个；也可按 z-index 取最上层。
export function nearestPopup(anchor, selector, { useZIndex = false, useDistance = true, attributeMatch } = {}) {
  try {
    const popups = queryAllVisible(selector);
    if (popups.length <= 1) return popups[0] ?? null;
    if (attributeMatch) {
      const value = anchor.getAttribute(attributeMatch.valueFrom);
      const hit = value && popups.find((p) => p.getAttribute(attributeMatch.key) === value);
      if (hit) return hit;
    }
    if (useZIndex) {
      let best = null;
      let top = -1;
      for (const p of popups) {
        const z = parseInt(getComputedStyle(p).zIndex || '0', 10);
        if (z > top) [top, best] = [z, p];
      }
      return best;
    }
    if (useDistance) {
      const a = anchor.getBoundingClientRect();
      let best = null;
      let min = Infinity;
      for (const p of popups) {
        const r = p.getBoundingClientRect();
        const d = Math.hypot(r.left - a.left, r.top - a.bottom);
        if (d < min) [min, best] = [d, p];
      }
      return best;
    }
    return popups[0];
  } catch {
    return null;
  }
}

export function elementByXPath(xpath) {
  return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}
