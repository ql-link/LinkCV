// 侧边栏发起的一次完整填写：授权 → 注入 → 补齐经历 → 扫描 → Jev 判断 → 出计划 → 写入 → 标记。
import { decideAll } from './decide/jev';
import { buildPlan, type PlanItem } from './decide/plan';
import { countEntries, type Profile } from './profile/profile';
import type { AddRowsReport } from './scan/add-rows';
import type { Settings } from './storage';
import type { FillStatus } from './writer/types';
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

export async function runFill(
  tabId: number,
  settings: Settings,
  profile: Profile,
  update: (patch: (s: RunState) => RunState) => void,
  signal: AbortSignal,
) {
  const stage = (key: StageKey, value: StageState) => update((s) => ({ ...s, stages: { ...s.stages, [key]: value } }));
  let current: StageKey = 'prepare';
  const onProgress = (raw: unknown) => {
    const m = raw as FillProgress;
    if (m?.type === 'af:progress') stage('fill', { status: 'running', detail: `${m.done}/${m.total}` });
  };
  browser.runtime.onMessage.addListener(onProgress);
  try {
    await inject(tabId);
    await send(tabId, { type: 'af:clear' });

    stage('prepare', { status: 'running' });
    const prepared = await send<PrepareResult>(tabId, { type: 'af:prepare', wanted: countEntries(profile), addRows: settings.addRows });
    const added = prepared.rows.reduce((n, r) => n + r.added, 0);
    update((s) => ({ ...s, site: prepared.site, rows: prepared.rows }));
    stage('prepare', { status: 'done', detail: added ? `新增 ${added} 段经历` : prepared.site ? '无需补齐' : '未识别站点，跳过' });

    current = 'scan';
    stage('scan', { status: 'running' });
    const fields = await send<ScanResult>(tabId, { type: 'af:scan' });
    stage('scan', { status: 'done', detail: `${fields.length} 个字段` });
    if (!fields.length) throw new Error('当前页面没有找到可填写的字段');
    if (signal.aborted) throw new Error('已停止');

    current = 'decide';
    stage('decide', { status: 'running', detail: `0/${fields.length}` });
    const decisions = await decideAll(fields, settings, {
      signal,
      onProgress: (done, total) => stage('decide', { status: 'running', detail: `${done}/${total}` }),
    });
    const failed = [...decisions.values()].filter((d) => 'error' in d);
    if (failed.length === fields.length) throw new Error((failed[0] as { error: string }).error);
    stage('decide', { status: 'done', detail: failed.length ? `${failed.length} 个判断失败` : `${fields.length} 个字段` });
    if (signal.aborted) throw new Error('已停止');

    const plan = buildPlan(fields, decisions, profile, settings);
    const toFill = plan.filter((p) => p.status === 'fill' && p.value != null);

    current = 'fill';
    stage('fill', { status: 'running', detail: `0/${toFill.length}` });
    const results = toFill.length
      ? await send<FillResult>(tabId, { type: 'af:fill', items: toFill.map((p) => ({ uid: p.uid, value: p.value!, label: p.label })) })
      : {};
    const items: ResultItem[] = plan.map((p) => ({ ...p, fill: results[p.uid] }));
    await send(tabId, { type: 'af:mark', marks: items.map((i) => ({ uid: i.uid, status: markOf(i.status, i.fill) })) });
    const filled = items.filter((i) => i.fill === 'filled').length;
    stage('fill', { status: 'done', detail: `${filled}/${toFill.length}` });
    update((s) => ({ ...s, items }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    stage(current, { status: 'error', detail: message });
    update((s) => ({ ...s, error: /Receiving end does not exist|Could not establish connection/.test(message) ? '页面已刷新或跳转，请重新开始' : message }));
  } finally {
    browser.runtime.onMessage.removeListener(onProgress);
  }
}
