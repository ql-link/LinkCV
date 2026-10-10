// 由侧边栏在用户点击“开始填写”时注入，不随页面自动加载。
import { detectSite } from '../src/autofill/writer/sites.js';
import { fillAll } from '../src/autofill/writer/fill.js';
import { clearAllFields } from '../src/autofill/writer/clear';
import { scanPage, elementByUid, currentValue } from '../src/autofill/scan/scanner';
import { addMissingRows } from '../src/autofill/scan/add-rows';
import type { SiteConfig } from '../src/autofill/writer/types';
import type { ToContent, PrepareResult, FillResult, FillProgress, MarkStatus } from '../src/autofill/messages';

const STYLE_ID = 'linkautofill-style';
const CSS = `
[data-af-mark="filled"] { outline: 2px solid #3f6fd8 !important; outline-offset: 1px; }
[data-af-mark="pending"] { outline: 2px solid #d9822b !important; outline-offset: 1px; }
[data-af-flash] { animation: af-flash 1.2s ease-out 1; }
@keyframes af-flash { 0% { box-shadow: 0 0 0 6px rgba(63,111,216,.35); } 100% { box-shadow: 0 0 0 0 rgba(63,111,216,0); } }
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// 自定义下拉的标记加在外层组件上，内部隐藏的 input 加了也看不见。
function markTarget(el: HTMLElement): HTMLElement {
  return (
    el.closest<HTMLElement>('.ant-select, .el-select, .ivu-select, .atsx-select, .ant-picker, .el-date-editor, .ant-cascader, .el-cascader') ?? el
  );
}

function clearMarks() {
  document.querySelectorAll('[data-af-mark]').forEach((el) => el.removeAttribute('data-af-mark'));
}

function applyMarks(marks: { uid: string; status: MarkStatus }[]) {
  ensureStyle();
  for (const { uid, status } of marks) {
    const el = elementByUid(uid);
    if (!el) continue;
    const target = markTarget(el);
    if (status === 'none') target.removeAttribute('data-af-mark');
    else target.setAttribute('data-af-mark', status);
  }
}

function focusField(uid: string) {
  const el = elementByUid(uid);
  if (!el) return false;
  const target = markTarget(el);
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  ensureStyle();
  target.removeAttribute('data-af-flash');
  void target.offsetWidth;
  target.setAttribute('data-af-flash', '');
  setTimeout(() => target.removeAttribute('data-af-flash'), 1300);
  return true;
}

export default defineContentScript({
  registration: 'runtime',
  matches: [],
  main() {
    // Reloading the extension invalidates old listeners without resetting the page's window.
    // Replace the listener when injection is needed instead of trusting a persistent boolean.
    const w = window as unknown as { __linkAutofillCleanup?: () => void };
    w.__linkAutofillCleanup?.();

    const documentToken = crypto.randomUUID();
    let fillController: AbortController | null = null;
    let activeRunId: string | null = null;
    const stopped = new Set<string>();
    let site: SiteConfig | null = null;

    const onMessage = (raw: unknown) => {
      const message = raw as ToContent;
      if (!message || typeof message !== 'object' || !String(message.type).startsWith('af:')) return undefined;
      if (message.type !== 'af:ping' && message.documentToken &&
          (message.documentToken !== documentToken || message.pageUrl !== location.href)) return Promise.reject(new Error('页面已刷新或跳转，请重新开始'));
      if (message.type !== 'af:stop' && message.runId && stopped.has(message.runId)) return Promise.reject(new Error('已停止'));
      if (['af:scan', 'af:fill', 'af:mark'].includes(message.type) && message.runId !== activeRunId) return Promise.reject(new Error('填写任务已变化，请重新开始'));
      switch (message.type) {
        case 'af:ping':
          return Promise.resolve({ documentToken, pageUrl: location.href });
        case 'af:stop':
          if (message.runId) {
            stopped.add(message.runId);
            if (stopped.size > 32) stopped.delete(stopped.values().next().value!);
          }
          if (message.runId === activeRunId) fillController?.abort();
          return Promise.resolve(true);
        case 'af:prepare':
          return (async (): Promise<PrepareResult> => {
            fillController?.abort();
            const controller = new AbortController();
            fillController = controller;
            activeRunId = message.runId ?? null;
            site = detectSite();
            const rows = message.addRows ? await addMissingRows(site, message.wanted, controller.signal) : [];
            return { site: site ? site.domain ?? site.kind ?? 'site' : null, rows };
          })();
        case 'af:scan':
          site ??= detectSite();
          return Promise.resolve(scanPage(site));
        case 'af:fill':
          return (async (): Promise<FillResult> => {
            fillController?.abort();
            const controller = new AbortController();
            fillController = controller;
            // SPA navigation can replace the form while the document stays alive.
            const pageUrl = location.href;
            const guard = window.setInterval(() => { if (location.href !== pageUrl) controller.abort(); }, 100);
            const fields = message.items.map((i) => ({ element: elementByUid(i.uid) ?? undefined, value: i.value, label: i.label }));
            try {
              const statuses = await fillAll(fields, {
              site,
              signal: controller.signal,
              shouldFill: (element: Element) => !message.keepExisting || !currentValue(element as HTMLElement),
              onProgress: (done: number, total: number) => {
                const progress: FillProgress = { type: 'af:progress', documentToken, runId: message.runId!, done, total };
                browser.runtime.sendMessage(progress).catch(() => {});
              },
              });
              return Object.fromEntries(message.items.map((i, k) => [i.uid, statuses[k]]));
            } finally { window.clearInterval(guard); }
          })();
        case 'af:mark':
          applyMarks(message.marks);
          return Promise.resolve(true);
        case 'af:focus':
          return Promise.resolve(focusField(message.uid));
        case 'af:clear':
          clearMarks();
          return Promise.resolve(true);
        case 'af:clear-values':
          return (async () => {
            fillController?.abort();
            const controller = new AbortController();
            fillController = controller;
            activeRunId = message.runId ?? null;
            const pageUrl = location.href;
            const guard = window.setInterval(() => { if (location.href !== pageUrl) controller.abort(); }, 100);
            try {
              const report = await clearAllFields(detectSite(), controller.signal);
              clearMarks();
              return report;
            } finally { window.clearInterval(guard); }
          })();
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(onMessage);
    w.__linkAutofillCleanup = () => {
      fillController?.abort();
      try { browser.runtime.onMessage.removeListener(onMessage); } catch {}
    };
  },
});
