// 把 Jev 的判断变成填写计划：规则拦截 → 判断第几段经历 → 取值并按页面格式转换。
import { isDateKey } from '../profile/keys';
import { lookup, type Profile, type ProfileValue } from '../profile/profile';
import type { ScannedField } from '../scan/scanner';
import { NONE, type DecisionResult } from './jev';
import { hasExplicitMeaning, manualReason } from './policy';

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

export const DEFAULT_PREFS: PlanPrefs & { addRows: boolean } = { minProb: 0.9, keepExisting: true, addRows: true };

// 模型容易填错、且填错代价高的字段，一律交给用户。
const BLOCK_RULES: { test: (f: ScannedField, key: string) => boolean; reason: string }[] = [
  { test: (f) => /分机|extension|\bext\b/i.test(f.label), reason: '电话分机' },
  { test: (f) => /配偶|spouse/i.test(`${f.label} ${f.section}`), reason: '配偶信息' },
  { test: (f, key) => key.startsWith('education.') && /高中|初中|中学|high school/i.test(`${f.label} ${f.placeholder}`), reason: '高中及以下学历' },
];

/**
 * 判断第几段经历：位于站点经历容器中的直接用容器序号；否则按同一 key 在页面上出现的次数计数，
 * 紧挨着且标签相同的同 key 字段（如拆开的年、月两个框）视为同一段。
 */
function assignIndexes(items: PlanItem[], fields: ScannedField[]) {
  const seen = new Map<string, number>();
  let prev: { key: string | null; label: string; placeholder: string } = { key: null, label: '', placeholder: '' };
  items.forEach((item, i) => {
    const f = fields[i]!;
    if (!item.key) {
      prev = { key: null, label: f.label, placeholder: f.placeholder };
      return;
    }
    if (f.group != null) item.index = f.group;
    else {
      const sameAsPrev = isDateKey(item.key) && prev.key === item.key && prev.label === f.label
        && /^(年|year|yyyy)$/i.test(prev.placeholder) && /^(月|month|mm)$/i.test(f.placeholder);
      const count = seen.get(item.key) ?? 0;
      item.index = sameAsPrev ? Math.max(0, count - 1) : count;
      if (!sameAsPrev) seen.set(item.key, count + 1);
    }
    prev = { key: item.key, label: f.label, placeholder: f.placeholder };
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
  if (/DD\/MM\/YYYY/i.test(hint)) return mo && d ? `${pad(d)}/${pad(mo)}/${y}` : null;
  if (/MM\/DD\/YYYY/i.test(hint)) return mo && d ? `${pad(mo)}/${pad(d)}/${y}` : null;
  if (/YYYY-MM-DD/i.test(hint) || f.kind === 'input:date') return mo && d ? `${y}-${pad(mo)}-${pad(d)}` : null;
  if (/YYYY\.MM/i.test(hint)) return mo ? `${y}.${pad(mo)}` : null;
  if (/YYYY\/MM/i.test(hint)) return mo ? `${y}/${pad(mo)}` : null;
  if (/YYYY-MM/i.test(hint) || f.kind === 'input:month') return mo ? `${y}-${pad(mo)}` : null;
  return mo ? (d ? `${y}-${pad(mo)}-${pad(d)}` : `${y}-${pad(mo)}`) : y;
}

export function formatValue(key: string, raw: ProfileValue, f: ScannedField): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'boolean') return raw ? '是' : '否';
  if (Array.isArray(raw)) {
    const list = raw.filter(Boolean);
    if (!list.length) return null;
    return f.isChoice ? (list.length === 1 ? list[0]! : null) : list.join('、');
  }
  const text = String(raw).trim();
  if (key === 'education.trainingMode' && /全日制|自考|自学考试|成人教育|远程教育/.test(text)) return null;
  if (key === 'education.studyMode' && /是否全日制/.test(f.label)) {
    return text === '全日制' ? '是' : text === '非全日制' ? '否' : null;
  }
  if (isDateKey(key)) return formatDate(text, f);
  return text || null;
}

export function buildPlan(fields: ScannedField[], decisions: Map<string, DecisionResult>, profile: Profile, prefs: PlanPrefs): PlanItem[] {
  const items: PlanItem[] = fields.map((f) => {
    const base: PlanItem = { uid: f.uid, section: f.section, label: f.label || f.placeholder, key: null, index: 0, value: null, prob: null, status: 'pending' };
    const manual = manualReason(f);
    if (manual) return { ...base, status: 'none', reason: manual };
    const d = decisions.get(f.uid);
    if (!d) return { ...base, reason: '未判断' };
    if ('error' in d) return { ...base, reason: `判断失败：${d.error}` };
    if (d.choice === NONE) return { ...base, prob: d.prob, status: 'none', reason: '简历中没有对应项' };
    const blocked = BLOCK_RULES.find((r) => r.test(f, d.choice));
    if (blocked) return { ...base, key: d.choice, prob: d.prob, status: 'none', reason: `不自动填写：${blocked.reason}` };
    if (!hasExplicitMeaning(f, d.choice)) return { ...base, key: d.choice, prob: d.prob, reason: '字段含义不能确定，未自动填写' };
    if (d.choice === 'basics.idNumber') {
      const basics = profile.basics;
      const idType = basics && !Array.isArray(basics) ? String(basics.idType ?? '') : '';
      if (/护照|passport/i.test(f.label) && !/^(护照|passport)$/i.test(idType)
        || /身份证/.test(f.label) && !/^(居民身份证|身份证|中华人民共和国居民身份证|resident identity card|identity card)$/i.test(idType)) {
        return { ...base, key: d.choice, prob: d.prob, reason: '证件类型与号码字段不对应，未自动填写' };
      }
    }
    if (/工作/.test(f.section) && /实习/.test(f.section) && /^(work|internship)\./.test(d.choice)
      && Array.isArray(profile.work) && profile.work.length && Array.isArray(profile.internship) && profile.internship.length) {
      return { ...base, key: d.choice, prob: d.prob, reason: '工作与实习合并后的顺序需要确认，未自动填写' };
    }
    // 混合工作/实习模块里，模型措辞差异不能把第二段经历重新计为第一段。
    const key = /工作/.test(f.section) ? d.choice.replace(/^internship\./, 'work.') : d.choice;
    return { ...base, key, prob: d.prob, status: 'fill' };
  });

  assignIndexes(items, fields);

  items.forEach((item, i) => {
    if (item.status !== 'fill' || !item.key) return;
    const f = fields[i]!;
    const raw = lookup(profile, item.key, item.index);
    item.value = formatValue(item.key, raw, f);
    if (item.value == null) {
      item.status = 'pending';
      item.reason = raw != null && raw !== '' ? '资料无法精确对应控件格式，未自动填写'
        : item.index > 0 ? `简历中没有第 ${item.index + 1} 段的这一项` : '简历中没有这一项';
    } else if ((item.prob ?? 0) < Math.max(0.9, prefs.minProb)) {
      item.status = 'pending';
      item.reason = '模型把握不足，请确认后手动填写';
    } else if (prefs.keepExisting && f.hasValue) {
      item.status = 'kept';
      item.reason = '已有内容，未覆盖';
    }
  });
  return items;
}
