// 把 Jev 的判断变成填写计划：规则拦截 → 起止时间纠正 → 判断第几段经历 → 取值并按页面格式转换。
import { START_END_PAIRS, isDateKey } from '../profile/keys';
import { lookup, type Profile, type ProfileValue } from '../profile/profile';
import type { ScannedField } from '../scan/scanner';
import { NONE, type DecisionResult } from './jev';

export type PlanStatus = 'fill' | 'pending' | 'none' | 'kept';

export interface PlanItem {
  uid: string;
  section: string;
  label: string;
  key: string | null;
  index: number;
  value: string | null;
  prob: number | null;
  status: PlanStatus;
  reason?: string;
}

export interface PlanPrefs {
  /** Jev 概率低于该值时不自动填写，只给出建议。 */
  minProb: number;
  /** 已有内容的字段不覆盖。 */
  keepExisting: boolean;
}

export const DEFAULT_PREFS: PlanPrefs & { addRows: boolean } = { minProb: 0.6, keepExisting: true, addRows: true };

// 模型容易填错、且填错代价高的字段，一律交给用户。
const BLOCK_RULES: { test: (f: ScannedField, key: string) => boolean; reason: string }[] = [
  { test: (f) => /分机|extension|\bext\b/i.test(f.label), reason: '电话分机' },
  { test: (f) => /配偶|spouse/i.test(`${f.label} ${f.section}`), reason: '配偶信息' },
  { test: (f, key) => key.startsWith('education.') && /高中|初中|中学|high school/i.test(`${f.label} ${f.placeholder}`), reason: '高中及以下学历' },
];

const END_TO_START = Object.fromEntries(Object.entries(START_END_PAIRS).map(([s, e]) => [e, s]));
const startKeyOf = (key: string) => (START_END_PAIRS[key] ? key : END_TO_START[key] ?? null);

/**
 * “起止时间”这类同一标签下的连续日期框：两个框按“开始、结束”，四个框按“开始年、开始月、结束年、结束月”。
 */
function fixStartEnd(items: PlanItem[], fields: ScannedField[]) {
  let i = 0;
  while (i < items.length) {
    const base = items[i]!.key && startKeyOf(items[i]!.key!);
    if (!base || !fields[i]!.label) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < items.length && fields[j]!.label === fields[i]!.label && fields[j]!.section === fields[i]!.section && items[j]!.key && startKeyOf(items[j]!.key!) === base) j++;
    const run = j - i;
    if (run === 2 || run === 4) {
      const half = run / 2;
      for (let k = 0; k < run; k++) items[i + k]!.key = k < half ? base : START_END_PAIRS[base]!;
    }
    i = j;
  }
}

/**
 * 判断第几段经历：位于站点经历容器中的直接用容器序号；否则按同一 key 在页面上出现的次数计数，
 * 紧挨着且标签相同的同 key 字段（如拆开的年、月两个框）视为同一段。
 */
function assignIndexes(items: PlanItem[], fields: ScannedField[]) {
  const seen = new Map<string, number>();
  let prev: { key: string | null; label: string } = { key: null, label: '' };
  items.forEach((item, i) => {
    const f = fields[i]!;
    if (!item.key) {
      prev = { key: null, label: f.label };
      return;
    }
    if (f.group != null) item.index = f.group;
    else {
      const sameAsPrev = prev.key === item.key && prev.label === f.label;
      const count = seen.get(item.key) ?? 0;
      item.index = sameAsPrev ? Math.max(0, count - 1) : count;
      if (!sameAsPrev) seen.set(item.key, count + 1);
    }
    prev = { key: item.key, label: f.label };
  });
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(raw: string, f: ScannedField): string | null {
  if (raw === '至今') return /^(年|月|year|month)$/i.test(f.placeholder) ? null : '至今';
  const m = raw.match(/^(\d{4})(?:[-/.年](\d{1,2}))?(?:[-/.月](\d{1,2}))?/);
  if (!m) return raw;
  const y = m[1]!;
  const mo = m[2] ? Number(m[2]) : null;
  const d = m[3] ? Number(m[3]) : null;
  const hint = `${f.placeholder} ${f.label}`;
  const ph = f.placeholder.trim();
  if (/^(年|year|yyyy)$/i.test(ph) || (/年$/.test(f.label) && !/月/.test(hint))) return y;
  if (/^(月|month|mm)$/i.test(ph)) return mo ? String(mo) : null;
  if (/DD\/MM\/YYYY/i.test(hint)) return `${pad(d ?? 1)}/${pad(mo ?? 1)}/${y}`;
  if (/MM\/DD\/YYYY/i.test(hint)) return `${pad(mo ?? 1)}/${pad(d ?? 1)}/${y}`;
  if (/YYYY-MM-DD/i.test(hint) || f.kind === 'input:date') return `${y}-${pad(mo ?? 1)}-${pad(d ?? 1)}`;
  if (/YYYY\.MM/i.test(hint)) return `${y}.${pad(mo ?? 1)}`;
  if (/YYYY\/MM/i.test(hint)) return `${y}/${pad(mo ?? 1)}`;
  if (/YYYY-MM/i.test(hint) || f.kind === 'input:month') return `${y}-${pad(mo ?? 1)}`;
  return mo ? (d ? `${y}-${pad(mo)}-${pad(d)}` : `${y}-${pad(mo)}`) : y;
}

// 简历里没有单独写、但能从其他字段推出来的值。
function derive(profile: Profile, key: string): ProfileValue {
  const name = String(lookup(profile, 'basics.name') ?? '');
  const chinese = /^[一-龥]{2,4}$/.test(name);
  if (key === 'basics.lastNameZh' && chinese) return name.slice(0, 1);
  if (key === 'basics.firstNameZh' && chinese) return name.slice(1);
  if (key === 'basics.age') {
    const birth = String(lookup(profile, 'basics.birthDate') ?? '').match(/^(\d{4})-(\d{1,2})/);
    if (birth) {
      const now = new Date();
      return String(now.getFullYear() - Number(birth[1]) - (now.getMonth() + 1 < Number(birth[2]) ? 1 : 0));
    }
  }
  return undefined;
}

export function formatValue(key: string, raw: ProfileValue, f: ScannedField): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'boolean') return raw ? '是' : '否';
  if (Array.isArray(raw)) {
    const list = raw.filter(Boolean);
    if (!list.length) return null;
    return f.isChoice ? list[0]! : list.join('、');
  }
  const text = String(raw).trim();
  if (isDateKey(key)) return formatDate(text, f);
  return text || null;
}

export function buildPlan(fields: ScannedField[], decisions: Map<string, DecisionResult>, profile: Profile, prefs: PlanPrefs): PlanItem[] {
  const items: PlanItem[] = fields.map((f) => {
    const base: PlanItem = { uid: f.uid, section: f.section, label: f.label || f.placeholder, key: null, index: 0, value: null, prob: null, status: 'pending' };
    const d = decisions.get(f.uid);
    if (!d) return { ...base, reason: '未判断' };
    if ('error' in d) return { ...base, reason: `判断失败：${d.error}` };
    if (d.choice === NONE) return { ...base, prob: d.prob, status: 'none', reason: '简历中没有对应项' };
    const blocked = BLOCK_RULES.find((r) => r.test(f, d.choice));
    if (blocked) return { ...base, key: d.choice, prob: d.prob, status: 'none', reason: `不自动填写：${blocked.reason}` };
    return { ...base, key: d.choice, prob: d.prob, status: 'fill' };
  });

  fixStartEnd(items, fields);
  assignIndexes(items, fields);

  items.forEach((item, i) => {
    if (item.status !== 'fill' || !item.key) return;
    const f = fields[i]!;
    const raw = lookup(profile, item.key, item.index) ?? derive(profile, item.key);
    item.value = formatValue(item.key, raw, f);
    if (item.value == null) {
      item.status = 'pending';
      item.reason = item.index > 0 ? `简历中没有第 ${item.index + 1} 段的这一项` : '简历中没有这一项';
    } else if ((item.prob ?? 0) < prefs.minProb) {
      item.status = 'pending';
      item.reason = '模型把握不足，请确认后手动填写';
    } else if (prefs.keepExisting && f.hasValue) {
      item.status = 'kept';
      item.reason = '已有内容，未覆盖';
    }
  });
  return items;
}
