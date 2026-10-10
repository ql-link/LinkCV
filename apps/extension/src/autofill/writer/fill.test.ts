import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fillAll, fillField } from './fill.js';
import { currentValue } from '../scan/scanner';
import { pickDate } from './calendar.js';
import { pickOption } from './match.js';
const NativeMouseEvent = MouseEvent;
beforeEach(() => {
  vi.useFakeTimers();
  // Vitest 的全局 Window 代理不满足 jsdom 的 view 品牌检查；仅移除这个非交互参数，保留真实事件派发。
  vi.stubGlobal('MouseEvent', class extends NativeMouseEvent {
    constructor(type: string, init: MouseEventInit = {}) { super(type, { ...init, view: null }); }
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30, toJSON() {} });
});
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function finish<T>(promise: Promise<T>) { await vi.runAllTimersAsync(); return promise; }
it('preserves content entered after scanning instead of overwriting it', async () => {
  const input = document.createElement('input');
  document.body.append(input);
  input.value = '用户刚输入的内容';
  const statuses = await finish(fillAll([{ element: input, value: '张三', label: '姓名' }], { shouldFill: (element) => !currentValue(element as HTMLElement) }));
  expect(statuses).toEqual(['kept']);
  expect(input.value).toBe('用户刚输入的内容');
});
it('skips writes when cancelled before the first field', async () => {
  const input = document.createElement('input');
  document.body.append(input);
  const controller = new AbortController();
  controller.abort();
  expect(await finish(fillAll([{ element: input, value: '张三' }], { signal: controller.signal }))).toEqual(['skipped']);
  expect(input.value).toBe('');
});

it('confirms ordinary text after framework events without using an instance value setter', async () => {
  document.body.innerHTML = '<input aria-label="姓名">';
  const input = document.querySelector('input')!;
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
  const instanceSetter = vi.fn((value) => native.set!.call(input, value));
  Object.defineProperty(input, 'value', { get: () => native.get!.call(input), set: instanceSetter, configurable: true });
  const update = vi.fn();
  input.addEventListener('input', update);
  expect(await finish(fillField(input, '张三', { site: null }))).toBe('filled');
  expect(input.value).toBe('张三');
  expect(update).toHaveBeenCalled();
  expect(instanceSetter).not.toHaveBeenCalled();
});

it('does not report success when a controlled text field restores its value', async () => {
  document.body.innerHTML = '<input>';
  const input = document.querySelector('input')!;
  input.addEventListener('change', () => { input.value = ''; });
  expect(await finish(fillField(input, '张三', { site: null }))).toBe('failed');
  expect(input.value).toBe('');
});

it('does not type into an unknown custom selector', async () => {
  document.body.innerHTML = '<div role="combobox"><input></div>';
  const input = document.querySelector('input')!;
  const change = vi.fn();
  input.addEventListener('input', change);
  expect(await finish(fillField(input, '示例大学', { site: null }))).toBe('skipped');
  expect(input.value).toBe('');
  expect(change).not.toHaveBeenCalled();
  document.body.innerHTML = '<input placeholder="请选择学校">';
  const unknown = document.querySelector('input')!;
  expect(await finish(fillField(unknown, '示例大学', { site: null }))).toBe('skipped');
  expect(unknown.value).toBe('');
});

it('requires a unique exact native select option and verifies the selected value', async () => {
  document.body.innerHTML = '<select><option value="">请选择</option><option value="school">示例大学</option></select>';
  const select = document.querySelector('select')!;
  expect(await finish(fillField(select, '示例大学', { site: null }))).toBe('filled');
  expect(select.value).toBe('school');
  select.value = '';
  select.insertAdjacentHTML('beforeend', '<option value="other">示例大学</option>');
  expect(await finish(fillField(select, '示例大学', { site: null }))).toBe('failed');
  expect(select.value).toBe('');
});

const mtdSite = { option_container_selector: '.mtd-select-popup', option_selector: '.mtd-select-item' };

it('confirms an MTD selection from its committed label rather than its search input', async () => {
  document.body.innerHTML = '<div class="mtd-select"><input><span class="mtd-select-filter-label mtd-select-filter-hint">请选择</span></div><div class="mtd-select-popup"><li class="mtd-select-item">示例大学</li></div>';
  const input = document.querySelector('input')!;
  document.querySelector('li')!.addEventListener('click', () => {
    const label = document.querySelector('span')!;
    label.textContent = '示例大学'; label.classList.remove('mtd-select-filter-hint');
    input.value = ''; document.querySelector<HTMLElement>('.mtd-select-popup')!.style.display = 'none';
  });
  expect(await finish(fillField(input, '示例大学', { site: mtdSite }))).toBe('filled');
  expect(currentValue(input)).toBe('示例大学');
});

it('restores a failed remote search instead of leaving the query as a selection', async () => {
  document.body.innerHTML = '<div class="mtd-select"><input></div><div class="mtd-select-popup"></div>';
  const input = document.querySelector('input')!;
  input.addEventListener('input', () => {
    document.querySelector('.mtd-select-popup')!.innerHTML = '<li class="mtd-select-item">另一个大学</li>';
  });
  expect(await finish(fillField(input, '示例大学', { site: mtdSite }))).toBe('failed');
  expect(input.value).toBe('');
});

it('does not treat an option click or search query as a committed MTD selection', async () => {
  document.body.innerHTML = '<div class="mtd-select"><input><span class="mtd-select-filter-label mtd-select-filter-hint">请选择</span></div><div class="mtd-select-popup"></div>';
  const input = document.querySelector('input')!;
  input.addEventListener('input', () => { document.querySelector('.mtd-select-popup')!.innerHTML = '<li class="mtd-select-item">示例大学</li>'; });
  expect(await finish(fillField(input, '示例大学', { site: mtdSite }))).toBe('failed');
  expect(input.value).toBe('');
});

it('restores an unmatched Ant Design search and skips a date range without two endpoints', async () => {
  document.body.innerHTML = '<div class="ant-select"><span class="ant-select-selection-search"><input></span></div><div class="ant-select-dropdown"><li class="ant-select-item-option">其他大学</li></div>';
  const input = document.querySelector('input')!;
  expect(await finish(fillField(input, '示例大学', { site: null, label: '学校名称' }))).toBe('failed');
  expect(input.value).toBe('');
  document.body.innerHTML = '<div class="atsx-date-picker-period-month"><input><button>起止时间</button></div>';
  const clicked = vi.fn(); document.querySelector('button')!.addEventListener('click', clicked);
  expect(await finish(fillField(document.querySelector('input')!, '2024-09', { site: null }))).toBe('skipped');
  expect(clicked).not.toHaveBeenCalled();
  document.body.innerHTML = '<div class="ant-picker ant-picker-range"><input></div>';
  expect(await finish(fillField(document.querySelector('input')!, '2024-09', { site: null }))).toBe('skipped');
});

it('does not choose a similar school or an unknown day', async () => {
  expect(pickOption(['示例大学附属学院'], '示例大学')).toBeNull();
  expect(pickOption(['大学本科'], '本科')).toBe('大学本科');
  expect(pickOption(['示例大学', '示例大学'], '示例大学')).toBeNull();
  expect(pickOption(['已婚已育'], '已婚')).toBeNull();
  document.body.innerHTML = '<div id="calendar"><span class="year">2024年</span><button class="day">1</button></div>';
  const day = document.querySelector('button')!;
  const click = vi.fn(); day.addEventListener('click', click);
  expect(await finish(pickDate({ container: document.querySelector('#calendar'), dateStr: '2024-09', yearPanelSelector: null, yearElementSelector: '.year', dayElementSelector: '.day' }))).toBe(false);
  expect(click).not.toHaveBeenCalled();
});
