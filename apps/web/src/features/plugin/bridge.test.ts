import { afterEach, expect, it, vi } from 'vitest';
import { sendPluginCommand } from './bridge';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('sends only the selected resume ID and accepts only a matching same-window reply', async () => {
  const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  const pending = sendPluginCommand('SELECT_RESUME', '42');
  const request = post.mock.calls[0]![0];
  expect(request).toEqual({ source: 'linkresume:web', command: 'SELECT_RESUME', resumeId: '42', requestId: expect.any(String) });
  let resolved = false;
  void pending.then(() => { resolved = true; });
  window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'https://other.example.test', data: { source: 'linkresume:extension', requestId: request.requestId, result: { ok: true } } }));
  await Promise.resolve();
  expect(resolved).toBe(false);
  window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin, data: { source: 'linkresume:extension', requestId: request.requestId, result: { ok: true, title: '示例简历' } } }));
  await expect(pending).resolves.toEqual({ ok: true, title: '示例简历' });
});

it('provides installation instructions when no extension replies', async () => {
  vi.useFakeTimers();
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  const pending = sendPluginCommand('PING');
  const assertion = expect(pending).rejects.toThrow('安装或更新插件');
  await vi.advanceTimersByTimeAsync(5000);
  await assertion;
});
