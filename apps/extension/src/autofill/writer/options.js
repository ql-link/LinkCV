// 下拉类控件的通用流程：展开 → 找到浮层 → 收集选项 → 匹配 → 点击。

import { sleep, textOf, queryAllVisible, closestOf, realClick, waitFor, nearestPopup, isVisible } from './dom.js';
import { setValueWithEvents } from './input.js';
import { pickOption, splitPath, isEmptyOptionText } from './match.js';

export const ANTD_DROPDOWN = '.ant-select-dropdown, .ant-dropdown';
export const ANTD_OPTION = ".ant-select-dropdown-menu-item, .ant-select-item, .ant-menu-item, .ant-select-item-option, li[role='option']";
export const ELEMENT_DROPDOWN = '.el-select-dropdown, .el-dropdown-menu';
export const ELEMENT_OPTION = '.el-select-dropdown__item, .el-dropdown-menu__item';

// 常见组件库的默认浮层选择器，在没有站点专用配置时使用。
const LIBRARY_POPUPS = [
  { owner: '.el-select', container: ELEMENT_DROPDOWN, option: ELEMENT_OPTION },
  { owner: '.ant-select, .ant-select-selector, .ant-cascader', container: ANTD_DROPDOWN, option: ANTD_OPTION },
  { owner: '.atsx-select', container: '.atsx-select-dropdown:not(.atsx-select-dropdown-hidden)', option: 'li[role="option"]' },
  { owner: '.ivu-select', container: '.ivu-select-dropdown', option: '.ivu-select-item' },
];

function popupSelectorsFor(el, site) {
  if (site?.option_container_selector && site?.option_selector) {
    return { container: site.option_container_selector, option: site.option_selector };
  }
  return LIBRARY_POPUPS.find((p) => closestOf(el, p.owner)) ?? null;
}

// 在浮层中收集可见选项，按文本去重；只有一项且是“暂无数据”时视为空。
export function optionsIn(container, optionSelector) {
  const items = queryAllVisible(optionSelector, container);
  if (items.length === 1 && isEmptyOptionText(textOf(items[0]))) return [];
  const out = [];
  for (const el of items) {
    const text = textOf(el);
    if (text && !out.some((o) => o.text === text)) out.push({ text, element: el });
  }
  return out;
}

/**
 * 展开下拉并收集选项。可搜索的下拉在没有选项时先输入目标值触发远程搜索，再轮询结果。
 * @returns {Promise<{ text: string, element: Element }[]>}
 */
export async function collectOptions(el, { value = null, searchable = false, site = null } = {}) {
  if (el instanceof HTMLSelectElement) {
    return Array.from(el.options || [])
      .map((o) => ({ text: textOf(o) || o.value || '', element: o }))
      .filter((o) => o.text);
  }
  let options = [];
  try {
    await realClick(el, 200);
    const sel = popupSelectorsFor(el, site);
    if (!sel) return [];
    let popup = nearestPopup(el, sel.container);
    if (popup) options = optionsIn(popup, sel.option);
    if ((!popup || !options.length) && el instanceof HTMLInputElement && searchable && value != null) {
      await setValueWithEvents(el, value, 0);
      await sleep(1000);
      await waitFor(
        () => {
          popup = nearestPopup(el, sel.container);
          if (!popup || !isVisible(popup)) return false;
          options = optionsIn(popup, sel.option);
          return options.length > 0;
        },
        20,
        100,
      );
    }
  } catch {}
  return options;
}

async function selectNativeByText(select, options, text) {
  const index = options.findIndex((o) => o.text === text);
  if (index < 0) return false;
  select.selectedIndex = index;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(20);
  return true;
}

// 先精确匹配，再交给本地匹配器挑最接近的一项。
export async function clickMatchingOption(el, options, value, { useMatcher = true, waitAfter = 300 } = {}) {
  try {
    const isNative = el instanceof HTMLSelectElement;
    const pick = async (text) => {
      const hit = options.find((o) => o.text === text);
      if (!hit) return false;
      if (isNative) return selectNativeByText(el, options, text);
      await realClick(hit.element, waitAfter);
      return true;
    };
    if (await pick(value)) return true;
    if (!useMatcher || !options.length) return false;
    const best = pickOption(options.map((o) => o.text), value);
    return best ? pick(best) : false;
  } catch {
    return false;
  }
}

const isSchoolOrMajor = (label) => /学校|专业/.test(label || '');

/**
 * 通用下拉：收集不到选项时返回 handled=false，交给后续兜底逻辑。
 * forceSearch 为 true 或字段标签含“学校/专业”时按可搜索下拉处理。
 */
export async function selectFromPopup(el, value, { label = '', site = null, forceSearch = false } = {}) {
  const searchable = forceSearch || isSchoolOrMajor(label);
  const options = await collectOptions(el, { value, searchable, site });
  if (!options.length) return { handled: false, success: false };
  return { handled: true, success: await clickMatchingOption(el, options, value) };
}

// 与 selectFromPopup 相同，但收集不到选项时也视为已处理（失败），不再走文本兜底。
export async function selectFromPopupStrict(el, value, { site = null, searchable = false } = {}) {
  const options = await collectOptions(el, { value, searchable, site });
  if (!options.length) return { handled: true, success: false };
  return { handled: true, success: await clickMatchingOption(el, options, value) };
}

// 在搜索框中输入，等待选项列表发生变化后返回新列表。
export async function typeAndCollect(input, value, collect) {
  if (!input) return [];
  try {
    const before = collect();
    const signature = before.map((o) => o.text).join('|');
    await setValueWithEvents(input, value);
    const changed = await waitFor(
      () => {
        const now = collect();
        if (!now.length) return false;
        return now.length !== before.length || now.map((o) => o.text).join('|') !== signature;
      },
      20,
      100,
    );
    return changed ? collect() : [];
  } catch {
    return [];
  }
}

/**
 * 树形下拉（antd TreeSelect、atsx tree）：逐层找节点，命中叶子或目标即点击，否则展开最接近的一项继续。
 * value 可写成“一级/二级/三级”，按路径逐级进行本地匹配。
 */
export async function selectInTree(popup, value, { wrapper, title, switcher, clickTarget = (el) => realClick(el, 10) }) {
  try {
    const root = popup.querySelector(wrapper);
    if (!root) return false;
    const path = splitPath(value);
    let items = root.querySelectorAll('ul > li');
    let depth = 0;
    let target = null;
    while (items?.length && depth < 10) {
      const nodes = [];
      const texts = [];
      for (const li of items) {
        const t = li.querySelector(title);
        if (t) {
          nodes.push(li);
          texts.push(textOf(t));
        }
      }
      if (!nodes.length) break;
      const exact = texts.indexOf(value);
      if (exact !== -1) {
        target = nodes[exact].querySelector(title);
        break;
      }
      const best = pickOption(texts, path[Math.min(depth, path.length - 1)] ?? value);
      const index = best == null ? -1 : texts.indexOf(best);
      if (index === -1) return false;
      const node = nodes[index];
      const toggle = node.querySelector(switcher);
      if (!toggle) {
        target = node.querySelector(title);
        break;
      }
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(10);
      items = node.querySelectorAll('ul > li');
      depth++;
      if (!items.length) {
        target = node.querySelector(title);
        break;
      }
    }
    if (depth >= 10 || !target) return false;
    await clickTarget(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 多列级联（antd/Element/iView Cascader）：每点一级，等下一列出现后继续；列数不再增加或浮层关闭即完成。
 */
export async function selectInCascader(el, value, { dropdownSelectors, menuSelector, menuItemSelector }) {
  try {
    const trigger = el.querySelector('.ant-select-selector');
    await realClick(trigger ?? el, 100);
    let popup = null;
    for (const s of dropdownSelectors) if ((popup = document.querySelector(s))) break;
    if (!popup) return false;
    if (!(await waitFor(() => popup.querySelectorAll(menuSelector).length > 0, 10, 100))) return false;
    const path = splitPath(value);
    for (let level = 0; level < 5; level++) {
      await sleep(100);
      const menus = popup.querySelectorAll(menuSelector);
      if (level >= menus.length) return false;
      const items = Array.from(menus[level].querySelectorAll(menuItemSelector));
      const texts = items.map(textOf).filter(Boolean);
      let hit = items.find((i) => textOf(i) === value);
      if (!hit && texts.length) {
        const best = pickOption(texts, path[Math.min(level, path.length - 1)] ?? value);
        hit = best ? items.find((i) => textOf(i) === best) : null;
      }
      if (!hit) return false;
      await realClick(hit, 100);
      await sleep(100);
      if (!document.contains(popup)) return true;
      if (popup.querySelectorAll(menuSelector).length <= level + 1) return true;
    }
    return false;
  } catch {
    return false;
  }
}
