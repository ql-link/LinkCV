import { afterEach, expect, it, vi } from 'vitest';
import { clearAllFields } from './writer/clear';

vi.mock('./writer/clear', () => ({ clearAllFields: vi.fn() }));
const listeners = new Set<(message: unknown) => unknown>();

async function setup() {
  vi.stubGlobal('defineContentScript', (config: unknown) => config);
  vi.stubGlobal('browser', { runtime: { onMessage: {
    addListener: (listener: (message: unknown) => unknown) => listeners.add(listener),
    removeListener: (listener: (message: unknown) => unknown) => listeners.delete(listener),
  } } });
  const { default: script } = await import('../../entrypoints/autofill.content');
  (script.main as () => void)();
  return Array.from(listeners)[0]!;
}

afterEach(() => {
  (window as unknown as { __linkAutofillCleanup?: () => void }).__linkAutofillCleanup?.();
  listeners.clear();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('replaces an injected listener after an extension reload', async () => {
  const previous = await setup();
  const previousPage = await previous({ type: 'af:ping' });
  const next = await setup();
  expect(listeners.size).toBe(1);
  expect(next).not.toBe(previous);
  expect(await next({ type: 'af:ping' })).not.toEqual(previousPage);
});

it('clears values only in the confirmed document and rejects a different URL', async () => {
  const listener = await setup();
  const page = await listener({ type: 'af:ping' }) as { documentToken: string; pageUrl: string };
  vi.mocked(clearAllFields).mockResolvedValue({ cleared: 2, empty: 4, failed: [] });
  await expect(listener({ type: 'af:clear-values', ...page, pageUrl: `${page.pageUrl}/other`, runId: 'clear-one' })).rejects.toThrow('页面已刷新或跳转');
  expect(clearAllFields).not.toHaveBeenCalled();
  expect(await listener({ type: 'af:clear-values', ...page, runId: 'clear-one' })).toEqual({ cleared: 2, empty: 4, failed: [] });
});
