// 侧边栏发起的一次完整填写：授权 → 注入 → 补齐经历 → 扫描 → Jev 判断 → 出计划 → 写入 → 标记。
import { decideAll } from './decide/jev';
import { buildPlan, type PlanItem } from './decide/plan';
import { countEntries, type Profile } from './profile/profile';
import type { AddRowsReport } from './scan/add-rows';
import type { Settings } from './storage';
import type { FillStatus } from './writer/types';
import type { ClearReport } from './writer/clear';
import { markOf, type FillProgress, type FillResult, type PrepareResult, type ScanResult, type ToContent } from './messages';

export type StageKey = 'prepare' | 'scan' | 'decide' | 'fill';

export interface StageState {
  status: 'waiting' | 'running' | 'done' | 'error';
  detail?: string;
}

export type ResultItem = PlanItem & { fill?: FillStatus };

export interface RunState {
  stages: Record<StageKey, StageState>;
  site?: string | null;
  rows?: AddRowsReport[];
  items?: ResultItem[];
  error?: string;
}

export const initialRunState = (): RunState => ({
  stages: { prepare: { status: 'waiting' }, scan: { status: 'waiting' }, decide: { status: 'waiting' }, fill: { status: 'waiting' } },
});

const CONTENT_SCRIPT = '/content-scripts/autofill.js';

export async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export function pageOrigin(url: string | undefined) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

// 必须在点击事件中直接调用，浏览器才会弹出授权提示。
export function requestPageAccess(origin: string) {
  return browser.permissions.request({ origins: [`${origin}/*`] });
}

function send<T>(tabId: number, message: ToContent): Promise<T> {
  return browser.tabs.sendMessage(tabId, message) as Promise<T>;
}

async function inject(tabId: number) {
  try {
    if (await send<boolean>(tabId, { type: 'af:ping' })) return;
  } catch {}
  await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
}

export function focusField(tabId: number, uid: string) {
  return send<boolean>(tabId, { type: 'af:focus', uid }).catch(() => false);
}

export function clearMarks(tabId: number) {
  return send<boolean>(tabId, { type: 'af:clear' }).catch(() => false);
}

export async function clearPageValues(tabId: number, expectedOrigin: string, signal: AbortSignal): Promise<ClearReport> {
  if (signal.aborted) throw new Error('页面已刷新或切换，清除已停止');
  await inject(tabId);
  const page = await send<{ documentToken: string; pageUrl: string }>(tabId, { type: 'af:ping' });
  if (signal.aborted || pageOrigin(page.pageUrl) !== expectedOrigin) throw new Error('页面已刷新或切换，清除已停止');
  const runId = crypto.randomUUID();
  const stop = () => { void send(tabId, { type: 'af:stop', ...page, runId }).catch(() => {}); };
  signal.addEventListener('abort', stop);
  try { return await send<ClearReport>(tabId, { type: 'af:clear-values', ...page, runId }); }
  finally { signal.removeEventListener('abort', stop); }
}

export async function runFill(
  tabId: number,
  settings: Settings,
  profile: Profile,
  origin: string,
  verifyAccount: () => Promise<void>,
  update: (patch: (s: RunState) => RunState) => void,
  signal: AbortSignal,
) {
  const stage = (key: StageKey, value: StageState) => update((s) => ({ ...s, stages: { ...s.stages, [key]: value } }));
  let current: StageKey = 'prepare';
  let documentToken = '';
  let pageUrl = '';
  const runId = crypto.randomUUID();
  const sendRun = async <T,>(message: ToContent): Promise<T> => {
    if (signal.aborted) throw new Error('已停止');
    return send<T>(tabId, { ...message, documentToken, pageUrl, runId });
  };
  const stop = () => { void send(tabId, { type: 'af:stop', documentToken, pageUrl, runId }).catch(() => {}); };
  signal.addEventListener('abort', stop);
  const onProgress = (raw: unknown, sender: { tab?: { id?: number } }) => {
    const m = raw as FillProgress;
    if (m?.type === 'af:progress' && m.documentToken === documentToken && m.runId === runId && sender.tab?.id === tabId) stage('fill', { status: 'running', detail: `${m.done}/${m.total}` });
  };
  browser.runtime.onMessage.addListener(onProgress);
  try {
    if (signal.aborted) throw new Error('已停止');
    await verifyAccount();
    await inject(tabId);
    const document = await send<{ documentToken: string; pageUrl: string }>(tabId, { type: 'af:ping' });
    documentToken = document.documentToken;
    pageUrl = document.pageUrl;
    await sendRun({ type: 'af:clear' });

    stage('prepare', { status: 'running' });
    const prepared = await sendRun<PrepareResult>({ type: 'af:prepare', wanted: countEntries(profile), addRows: settings.addRows });
    const added = prepared.rows.reduce((n, r) => n + r.added, 0);
    update((s) => ({ ...s, site: prepared.site, rows: prepared.rows }));
    stage('prepare', { status: 'done', detail: added ? `新增 ${added} 段经历` : prepared.site ? '无需补齐' : '未识别站点，跳过' });

    current = 'scan';
    stage('scan', { status: 'running' });
    const fields = await sendRun<ScanResult>({ type: 'af:scan' });
    stage('scan', { status: 'done', detail: `${fields.length} 个字段` });
    if (fields.length > 200) throw new Error('页面字段超过 200 个，请分步填写');
    if (!fields.length) throw new Error('当前页面没有找到可填写的字段');
    if (signal.aborted) throw new Error('已停止');

    current = 'decide';
    stage('decide', { status: 'running', detail: `0/${fields.length}` });
    const decisions = await decideAll(fields, origin, {
      signal,
      onProgress: (done, total) => stage('decide', { status: 'running', detail: `${done}/${total}` }),
    });
    const failed = [...decisions.values()].filter((d) => 'error' in d);
    if (failed.length === fields.length) throw new Error((failed[0] as { error: string }).error);
    stage('decide', { status: 'done', detail: failed.length ? `${failed.length} 个判断失败` : `${fields.length} 个字段` });
    if (signal.aborted) throw new Error('已停止');

    await verifyAccount();
    if (signal.aborted) throw new Error('已停止');
    const plan = buildPlan(fields, decisions, profile, settings);
    const toFill = plan.filter((p) => p.status === 'fill' && p.value != null);

    current = 'fill';
    stage('fill', { status: 'running', detail: `0/${toFill.length}` });
    const results = toFill.length
      ? await sendRun<FillResult>({ type: 'af:fill', keepExisting: settings.keepExisting, items: toFill.map((p) => ({ uid: p.uid, value: p.value!, label: p.label })) })
      : {};
    const items: ResultItem[] = plan.map((p) => ({ ...p, fill: results[p.uid] }));
    await sendRun({ type: 'af:mark', marks: items.map((i) => ({ uid: i.uid, status: markOf(i.status, i.fill) })) });
    const filled = items.filter((i) => i.fill === 'filled').length;
    stage('fill', { status: 'done', detail: `${filled}/${toFill.length}` });
    update((s) => ({ ...s, items }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    stage(current, { status: 'error', detail: message });
    update((s) => ({ ...s, error: /Receiving end does not exist|Could not establish connection/.test(message) ? '页面已刷新或跳转，请重新开始' : message }));
  } finally {
    signal.removeEventListener('abort', stop);
    browser.runtime.onMessage.removeListener(onProgress);
  }
}
