import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { DEFAULT_SETTINGS } from '../../src/autofill/storage';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  request: vi.fn(),
  connect: vi.fn(),
  list: vi.fn(),
  selected: vi.fn(),
  snapshot: vi.fn(),
  api: vi.fn(),
  run: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('../../src/features/job-capture/App', () => ({ default: () => null }));
vi.mock('../../src/api/linkresume', () => ({
  connectToLinkResume: mocks.connect,
  apiRequest: mocks.api,
  candidateOrigins: () => ['http://localhost:5173'],
  linkResumeUrl: (origin: string, path: string) => `${origin}${path}`,
  LinkResumeApiError: class extends Error {},
}));
vi.mock('../../src/api/autofill', () => ({
  loadResumeList: mocks.list,
  selectedSnapshot: mocks.selected,
  loadSnapshot: mocks.snapshot,
  saveSnapshot: vi.fn(),
  clearSnapshot: vi.fn(),
}));
vi.mock('../../src/autofill/storage', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/autofill/storage')>(),
  getSettings: async () => DEFAULT_SETTINGS,
  onStorageChange: () => () => {},
}));
vi.mock('../../src/autofill/run', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/autofill/run')>(),
  runFill: mocks.run,
  clearPageValues: mocks.clear,
}));

const origin = 'http://localhost:5173';
const connection = { origin, user: { id: '7', nickname: '测试账号' } };
const snapshot = {
  version: 1, user_id: '7', resume_id: '42', title: '虚构简历', lock_version: 1,
  profile_lock_version: null, updated_at: '2026-01-01T00:00:00Z',
  profile: { basics: { name: '张三' } }, warnings: [], missing: [],
};
let root: Root | null = null;
const activated = new Set<() => void>();
const updated = new Set<(id: number, info: { url?: string; status?: string }) => void>();

beforeEach(() => {
  vi.resetAllMocks();
  activated.clear();
  updated.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  mocks.query.mockResolvedValue([{ id: 9, url: 'https://apply.example.test/form' }]);
  mocks.connect.mockResolvedValue(connection);
  mocks.list.mockResolvedValue([{ id: '42', title: '虚构简历' }]);
  mocks.selected.mockResolvedValue({ origin, snapshot });
  mocks.snapshot.mockResolvedValue(snapshot);
  mocks.api.mockResolvedValue({ user: connection.user });
  mocks.request.mockResolvedValue(true);
  mocks.run.mockResolvedValue(undefined);
  mocks.clear.mockResolvedValue({ cleared: 3, empty: 8, failed: [] });
  vi.stubGlobal('browser', {
    tabs: {
      query: mocks.query,
      onActivated: { addListener: (fn: () => void) => activated.add(fn), removeListener: (fn: () => void) => activated.delete(fn) },
      onUpdated: {
        addListener: (fn: (id: number, info: { url?: string; status?: string }) => void) => updated.add(fn),
        removeListener: (fn: (id: number, info: { url?: string; status?: string }) => void) => updated.delete(fn),
      },
    },
    permissions: { request: mocks.request },
  });
});

function button(text: string) {
  return Array.from(document.querySelectorAll('button')).find((el) => el.textContent === text)!;
}

describe('clear all page values', () => {
  it('requires an explicit confirmation and requests the active site before clearing', async () => {
    await render();
    await act(async () => button('全部清除').click());
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('手动输入及之前各轮填写');
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    await act(async () => button('确认全部清除').click());
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith({ origins: ['https://apply.example.test/*'] });
    expect(mocks.clear).toHaveBeenCalledExactlyOnceWith(9, 'https://apply.example.test', expect.any(AbortSignal));
    expect(document.body.textContent).toContain('已清除 3 个字段');
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('can clear without a selected resume or a LinkResume login', async () => {
    mocks.selected.mockResolvedValue(null);
    mocks.connect.mockResolvedValue(null);
    await render();
    expect(startButton().disabled).toBe(true);
    expect(button('全部清除').disabled).toBe(false);
  });

  it('does not cancel clearing when returning from a permission prompt without a selected resume', async () => {
    mocks.selected.mockResolvedValue(null);
    mocks.connect.mockResolvedValue(null);
    let grant!: (value: boolean) => void;
    mocks.request.mockImplementation(() => new Promise<boolean>((resolve) => { grant = resolve; }));
    await render();
    await act(async () => button('全部清除').click());
    await act(async () => button('确认全部清除').click());
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => grant(true));
    expect(mocks.clear).toHaveBeenCalledExactlyOnceWith(9, 'https://apply.example.test', expect.any(AbortSignal));
    expect(mocks.clear.mock.calls[0]![2].aborted).toBe(false);
  });

  it('leaves values untouched after cancelling or denying permission', async () => {
    await render();
    await act(async () => button('全部清除').click());
    await act(async () => button('取消').click());
    expect(mocks.clear).not.toHaveBeenCalled();
    mocks.request.mockResolvedValue(false);
    await act(async () => button('全部清除').click());
    await act(async () => button('确认全部清除').click());
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('未清除内容');
  });

  it('cancels confirmation when the active tab changes', async () => {
    await render();
    await act(async () => button('全部清除').click());
    await act(async () => {
      mocks.query.mockResolvedValue([{ id: 10, url: 'https://other.example.test/form' }]);
      activated.forEach((fn) => fn());
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it('cancels clearing if navigation occurs during the permission prompt', async () => {
    let grant!: (value: boolean) => void;
    mocks.request.mockImplementation(() => new Promise<boolean>((resolve) => { grant = resolve; }));
    await render();
    await act(async () => button('全部清除').click());
    await act(async () => button('确认全部清除').click());
    await act(async () => { updated.forEach((fn) => fn(9, { status: 'loading' })); grant(true); });
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('清除已停止');
  });

  it('reports controls that could not be cleared', async () => {
    mocks.clear.mockResolvedValue({ cleared: 1, empty: 2, failed: ['工作类型'] });
    await render();
    await act(async () => button('全部清除').click());
    await act(async () => button('确认全部清除').click());
    expect(document.body.textContent).toContain('1 个控件未能清空');
    expect(document.body.textContent).toContain('工作类型');
  });

  it('shows retained values separately from fields filled in this run', async () => {
    mocks.run.mockImplementation(async (_tab, _settings, _profile, _origin, _verify, update) => {
      update((state: object) => ({ ...state, items: [
        { uid: 'one', status: 'kept', label: '姓名', section: '', key: 'basics.name', index: 0, value: '张三', prob: 1, reason: '已有内容，未覆盖' },
        { uid: 'two', status: 'fill', fill: 'filled', label: '邮箱', section: '', key: 'contact.email', index: 0, value: 'test@example.com', prob: 1 },
      ] }));
    });
    await render();
    await clickStart();
    expect(document.body.textContent).toContain('本轮已填 1');
    expect(document.body.textContent).toContain('保留已有 1');
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

async function render() {
  root = createRoot(document.getElementById('root')!);
  await act(async () => root!.render(<App />));
}

function startButton() {
  return Array.from(document.querySelectorAll('button')).find((button) => /开始填写|重新填写|填写中/.test(button.textContent ?? ''))!;
}

async function clickStart() {
  await act(async () => startButton().click());
}

describe('autofill site permission', () => {
  it('allows the first click on an ungranted site and requests only its origin before fetching or running', async () => {
    mocks.request.mockImplementation(() => {
      expect(mocks.snapshot).not.toHaveBeenCalled();
      expect(mocks.run).not.toHaveBeenCalled();
      return Promise.resolve(true);
    });
    await render();
    expect(startButton().disabled).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
    await clickStart();
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith({ origins: ['https://apply.example.test/*'] });
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(connection, '42', expect.any(AbortSignal));
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(9, DEFAULT_SETTINGS, snapshot.profile, origin, expect.any(Function), expect.any(Function), expect.any(AbortSignal));
  });

  it('does not fetch or run when the user denies access, and allows another attempt', async () => {
    mocks.request.mockResolvedValue(false);
    await render();
    await clickStart();
    expect(document.body.textContent).toContain('没有获得当前网站的访问权限');
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(startButton().disabled).toBe(false);
  });

  it('reports a failed permission request without fetching or running', async () => {
    mocks.request.mockRejectedValue(new Error('permission gesture missing'));
    await render();
    await clickStart();
    expect(document.body.textContent).toContain('无法申请网站权限');
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('keeps browser internal pages disabled', async () => {
    mocks.query.mockResolvedValue([{ id: 9, url: 'chrome://extensions/' }]);
    await render();
    expect(startButton().disabled).toBe(true);
    expect(document.body.textContent).toContain('当前页面不支持自动填写');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(['tab switch', 'navigation'])('cancels a pending permission request after %s', async (change) => {
    let grant!: (value: boolean) => void;
    mocks.request.mockImplementation(() => new Promise<boolean>((resolve) => { grant = resolve; }));
    await render();
    await clickStart();
    expect(startButton().disabled).toBe(true);
    await act(async () => {
      if (change === 'tab switch') {
        mocks.query.mockResolvedValue([{ id: 10, url: 'https://other.example.test/form' }]);
        activated.forEach((fn) => fn());
      } else {
        updated.forEach((fn) => fn(9, { status: 'loading' }));
      }
      grant(true);
    });
    expect(document.body.textContent).toContain('页面已刷新或切换');
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
