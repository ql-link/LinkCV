// Jev 决策客户端：每个字段一个 choice 问题，选项为全部字段 key 加“无对应”。
// 只发送页面字段的标签与结构，不发送任何简历内容。
import { KEYS } from '../profile/keys';
import type { ScannedField } from '../scan/scanner';

export interface JevSettings {
  endpoint: string;
  model: string;
  apiKey: string;
}

export const DEFAULT_JEV: JevSettings = {
  endpoint: 'https://aihubmix.com/v1/systemone',
  model: 'jev-1.13',
  apiKey: '',
};

export const NONE = 'none';
const NONE_DESC = '不对应简历中的任何一项（如验证码、声明勾选、与求职者无关或简历没有记录的信息）';
const INSTRUCTIONS = '这是网申表单中的一个输入框。求职者应在这里填写其简历中的哪一项信息？';
const TIMEOUT_MS = 15000;

export interface Decision {
  choice: string;
  prob: number;
  ranked: [string, number][];
}

export type DecisionResult = Decision | { error: string };

const CRITERIA: Record<string, string> = { ...KEYS, [NONE]: NONE_DESC };

function stateOf(f: ScannedField) {
  const state: Record<string, unknown> = { 页面模块标题: f.section || '（无）', 字段标签: f.label || '（无）' };
  if (f.placeholder) state.输入提示 = f.placeholder;
  state.控件类型 = f.isChoice ? `${f.kind}（选择类）` : f.kind;
  if (f.options.length) state.下拉选项 = f.options.slice(0, 6);
  return state;
}

function describeHttpError(status: number, body: string) {
  if (status === 401 || status === 403) return 'API Key 无效或没有权限';
  if (status === 400 && /model/i.test(body)) return '模型名不可用，请检查设置中的模型';
  if (status === 404) return '接口地址不存在，请检查设置中的接口地址';
  if (status === 429) return '请求过于频繁或额度不足';
  return `接口返回 ${status}`;
}

export async function decideField(f: ScannedField, settings: JevSettings, signal?: AbortSignal): Promise<Decision> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(settings.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      state: stateOf(f),
      questions: { slot: { type: 'choice', instructions: INSTRUCTIONS, criteria: CRITERIA } },
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(describeHttpError(res.status, text));
  const answer = JSON.parse(text)?.answers?.slot;
  if (!answer?.choice || !answer.probabilities) throw new Error('接口返回格式不符合预期');
  const ranked = (Object.entries(answer.probabilities) as [string, number][]).sort((a, b) => b[1] - a[1]);
  return { choice: answer.choice, prob: answer.probabilities[answer.choice] ?? ranked[0]![1], ranked: ranked.slice(0, 3) };
}

async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new Error('已取消');
    try {
      return await fn();
    } catch (e) {
      last = e;
      // 认证、模型、地址类错误重试没有意义
      if (e instanceof Error && /Key|模型|地址/.test(e.message)) break;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw last;
}

export async function decideAll(
  fields: ScannedField[],
  settings: JevSettings,
  { concurrency = 6, onProgress, signal }: { concurrency?: number; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<Map<string, DecisionResult>> {
  const results = new Map<string, DecisionResult>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < fields.length && !signal?.aborted) {
      const f = fields[next++]!;
      try {
        results.set(f.uid, await withRetry(() => decideField(f, settings, signal), signal));
      } catch (e) {
        results.set(f.uid, { error: e instanceof Error ? e.message : String(e) });
      }
      onProgress?.(++done, fields.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, fields.length) }, worker));
  return results;
}

// 设置页“测试连接”：用一个虚构字段发一次请求。
export async function testConnection(settings: JevSettings) {
  const started = performance.now();
  const d = await decideField(
    { uid: 'test', section: '教育经历', label: '毕业院校', placeholder: '请输入学校全称', kind: 'input:text', options: [], isChoice: false, group: null, hasValue: false },
    settings,
  );
  return { ok: d.choice === 'education.school', choice: d.choice, ms: Math.round(performance.now() - started) };
}
