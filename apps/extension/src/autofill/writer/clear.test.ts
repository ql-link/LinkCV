import { afterEach, expect, it, vi } from 'vitest';
import { clearAllFields } from './clear';

vi.mock('./dom.js', async (original) => ({
  ...await original<typeof import('./dom.js')>(),
  isVisible: (el: Element) => !el.closest('[hidden]'),
  sleep: async () => {},
}));
afterEach(() => { document.body.innerHTML = ''; });
const clear = (signal = new AbortController().signal) => clearAllFields(null, signal);

it('clears previous and manual values without requiring run marks and emits framework events', async () => {
  document.body.innerHTML = '<input aria-label="姓名" value="测试值"><textarea aria-label="工作描述">旧一轮填写</textarea><select aria-label="学历"><option value="">请选择</option><option selected value="test">测试选项</option></select>';
  const changed = vi.fn();
  document.body.addEventListener('input', changed);
  const report = await clear();
  expect(report).toEqual({ cleared: 3, empty: 0, failed: [] });
  expect(Array.from(document.querySelectorAll('input,textarea,select')).map((el) => (el as HTMLInputElement).value)).toEqual(['', '', '']);
  expect(changed).toHaveBeenCalledTimes(3);
  document.body.removeEventListener('input', changed);
});

it('does not clear passwords, hidden values, attachments, captcha, disabled or readonly text', async () => {
  document.body.innerHTML = '<input type="password" value="secret"><input type="hidden" value="token"><input type="file"><input disabled value="protected"><input readonly value="readonly"><input aria-label="验证码" value="code"><div hidden><input value="hidden text"></div>';
  expect(await clear()).toEqual({ cleared: 0, empty: 0, failed: [] });
  expect(Array.from(document.querySelectorAll('input')).map((el) => el.value)).toEqual(['secret', 'token', '', 'protected', 'readonly', 'code', 'hidden text']);
});

it('clears selected MTD values through the component clear action', async () => {
  document.body.innerHTML = '<div class="mtd-select"><input value="测试学校"><span class="mtd-select-filter-label">测试学校</span><button class="mtd-select-filter-delete"></button></div>';
  const input = document.querySelector('input')!;
  const label = document.querySelector('span')!;
  document.querySelector('button')!.addEventListener('click', () => { input.value = ''; label.textContent = ''; label.classList.add('mtd-select-filter-hint'); });
  expect(await clear()).toEqual({ cleared: 1, empty: 0, failed: [] });
});

it('reports a select without a clear action instead of pretending its search input resets the selection', async () => {
  document.body.innerHTML = '<div class="mtd-select"><input aria-label="工作类型" value="全职"><span class="mtd-select-filter-label">全职</span></div>';
  const report = await clear();
  expect(report.cleared).toBe(0);
  expect(report.failed).toEqual(['工作类型']);
  expect(document.querySelector('input')!.value).toBe('全职');
});

it('unchecks form checkboxes, retains unsupported radios, and counts empty controls separately', async () => {
  document.body.innerHTML = '<label>至今<input type="checkbox" checked></label><label>选择<input type="radio" checked></label><input value="">';
  expect(await clear()).toEqual({ cleared: 1, empty: 1, failed: ['选择'] });
  expect(document.querySelector<HTMLInputElement>('[type="checkbox"]')!.checked).toBe(false);
});

it('stops before touching the page when cancelled', async () => {
  document.body.innerHTML = '<input value="用户输入">';
  const controller = new AbortController();
  controller.abort();
  await expect(clear(controller.signal)).rejects.toThrow('清除已停止');
  expect(document.querySelector('input')!.value).toBe('用户输入');
});

it('reports values restored by a dependent component', async () => {
  document.body.innerHTML = '<input aria-label="城市" value="旧值">';
  document.querySelector('input')!.addEventListener('change', (event) => { (event.target as HTMLInputElement).value = '默认值'; });
  expect(await clear()).toEqual({ cleared: 0, empty: 0, failed: ['城市'] });
});

it('clears a dependent field before clearing its parent disables it', async () => {
  document.body.innerHTML = '<div class="mtd-select"><input aria-label="职位" value="测试职位"><button class="mtd-select-filter-delete"></button></div><input aria-label="部门" value="测试部门">';
  const parent = document.querySelector('input')!;
  const child = document.querySelectorAll('input')[1]!;
  document.querySelector('button')!.addEventListener('click', () => { parent.value = ''; child.disabled = true; });
  expect(await clear()).toEqual({ cleared: 2, empty: 0, failed: [] });
  expect(child.value).toBe('');
});

it('rescans fields after unchecking a toggle re-enables them', async () => {
  document.body.innerHTML = '<input aria-label="结束时间" disabled value="2026-06"><label>至今<input type="checkbox" checked></label>';
  const end = document.querySelector('input')!;
  document.querySelector('[type="checkbox"]')!.addEventListener('change', () => { end.disabled = false; });
  expect(await clear()).toEqual({ cleared: 2, empty: 0, failed: [] });
  expect(end.value).toBe('');
});
