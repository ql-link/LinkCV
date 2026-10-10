// 由侧边栏在用户点击“开始填写”时注入，不随页面自动加载。
import { detectSite } from '../src/writer/sites.js';
import { fillAll } from '../src/writer/fill.js';
import { scanPage, elementByUid } from '../src/scan/scanner';
import { addMissingRows } from '../src/scan/add-rows';
import type { SiteConfig } from '../src/writer/types';
import type { ToContent, PrepareResult, FillResult, FillProgress, MarkStatus } from '../src/messages';

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
    const w = window as unknown as { __linkAutofill?: boolean };
    if (w.__linkAutofill) return;
    w.__linkAutofill = true;

    let site: SiteConfig | null = null;

    browser.runtime.onMessage.addListener((raw: unknown) => {
      const message = raw as ToContent;
      if (!message || typeof message !== 'object' || !String(message.type).startsWith('af:')) return undefined;
      switch (message.type) {
        case 'af:ping':
          return Promise.resolve(true);
        case 'af:prepare':
          return (async (): Promise<PrepareResult> => {
            site = detectSite();
            const rows = message.addRows ? await addMissingRows(site, message.wanted) : [];
            return { site: site ? site.domain ?? site.kind ?? 'site' : null, rows };
          })();
        case 'af:scan':
          site ??= detectSite();
          return Promise.resolve(scanPage(site));
        case 'af:fill':
          return (async (): Promise<FillResult> => {
            const fields = message.items.map((i) => ({ element: elementByUid(i.uid) ?? undefined, value: i.value, label: i.label }));
            const statuses = await fillAll(fields, {
              site,
              onProgress: (done: number, total: number) => {
                const progress: FillProgress = { type: 'af:progress', done, total };
                browser.runtime.sendMessage(progress).catch(() => {});
              },
            });
            return Object.fromEntries(message.items.map((i, k) => [i.uid, statuses[k]]));
          })();
        case 'af:mark':
          applyMarks(message.marks);
          return Promise.resolve(true);
        case 'af:focus':
          return Promise.resolve(focusField(message.uid));
        case 'af:clear':
          clearMarks();
          return Promise.resolve(true);
      }
      return undefined;
    });
  },
});
