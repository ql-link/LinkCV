import { afterEach, expect, it, vi } from 'vitest';
import { runFill, initialRunState, clearPageValues } from './run';
import { DEFAULT_SETTINGS } from './storage';
import { decideAll } from './decide/jev';
vi.mock('./decide/jev', () => ({ NONE: 'none', decideAll: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const send = vi.fn(async (_tab: number, message: { type: string }) => {
    if (message.type === 'af:ping') return { documentToken: 'document-one', pageUrl: 'https://apply.example.test/form' };
    if (message.type === 'af:prepare') return { site: null, rows: [] };
    if (message.type === 'af:scan') return [{ uid: 'one', section: '', label: '姓名', placeholder: '', kind: 'input:text', options: [], isChoice: false, group: null, hasValue: false }];
    if (message.type === 'af:fill') return { one: 'filled' };
    return true;
  });
  vi.stubGlobal('browser', { tabs: { sendMessage: send }, runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
  vi.mocked(decideAll).mockResolvedValue(new Map([['one', { choice: 'basics.name', prob: 0.99, ranked: [] }]]));
  return send;
}

it('verifies identity before writing and binds messages to the scanned document', async () => {
  const send = setup();
  const verify = vi.fn(async () => {});
  await runFill(7, DEFAULT_SETTINGS, { basics: { name: '张三' } }, 'http://localhost:5173', verify, () => {}, new AbortController().signal);
  expect(verify).toHaveBeenCalledTimes(2);
  const write = send.mock.calls.find((call) => call[1].type === 'af:fill');
  expect(write).toEqual([7, expect.objectContaining({ documentToken: 'document-one', pageUrl: 'https://apply.example.test/form', items: [{ uid: 'one', value: '张三', label: '姓名' }] })]);
});

it('binds clear-all to the current document and URL without invoking the model', async () => {
  const send = setup();
  await clearPageValues(7, 'https://apply.example.test', new AbortController().signal);
  expect(send.mock.calls.find((call) => call[1].type === 'af:clear-values')).toEqual([7, expect.objectContaining({
    documentToken: 'document-one', pageUrl: 'https://apply.example.test/form', runId: expect.any(String),
  })]);
});

it('does not clear a page that has changed to another origin', async () => {
  const send = setup();
  await expect(clearPageValues(7, 'https://other.example.test', new AbortController().signal)).rejects.toThrow('清除已停止');
  expect(send.mock.calls.some((call) => call[1].type === 'af:clear-values')).toBe(false);
});

it('does not write after identity verification fails', async () => {
  const send = setup();
  let state = initialRunState();
  await runFill(7, DEFAULT_SETTINGS, { basics: { name: '张三' } }, 'http://localhost:5173', async () => { throw new Error('账户已切换'); }, (patch) => { state = patch(state); }, new AbortController().signal);
  expect(send.mock.calls.some((call) => call[1].type === 'af:fill')).toBe(false);
  expect(state.error).toBe('账户已切换');
});

it('propagates cancellation to the content script and skips writing', async () => {
  const send = setup();
  const controller = new AbortController();
  vi.mocked(decideAll).mockImplementation(async () => { controller.abort(); return new Map(); });
  await runFill(7, DEFAULT_SETTINGS, { basics: { name: '张三' } }, 'http://localhost:5173', async () => {}, () => {}, controller.signal);
  expect(send.mock.calls.some((call) => call[1].type === 'af:stop')).toBe(true);
  expect(send.mock.calls.some((call) => call[1].type === 'af:fill')).toBe(false);
});
