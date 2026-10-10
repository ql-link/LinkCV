import { afterEach, expect, it } from 'vitest';
import { fillAll } from './fill.js';
import { currentValue } from '../scan/scanner';
afterEach(() => { document.body.innerHTML = ''; });
it('preserves content entered after scanning instead of overwriting it', async () => {
  const input = document.createElement('input');
  document.body.append(input);
  input.value = '用户刚输入的内容';
  const statuses = await fillAll([{ element: input, value: '张三', label: '姓名' }], { shouldFill: (element) => !currentValue(element as HTMLElement) });
  expect(statuses).toEqual(['kept']);
  expect(input.value).toBe('用户刚输入的内容');
});
it('skips writes when cancelled before the first field', async () => {
  const input = document.createElement('input');
  document.body.append(input);
  const controller = new AbortController();
  controller.abort();
  expect(await fillAll([{ element: input, value: '张三' }], { signal: controller.signal })).toEqual(['skipped']);
  expect(input.value).toBe('');
});
