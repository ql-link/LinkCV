// JSON 简历：按 key 目录组织，数组分组按“最近的在前”排列。
import { KEYS, LIST_GROUPS, isListGroup, type ListGroup } from './keys';

export type ProfileValue = string | number | boolean | string[] | null | undefined;
export type ProfileEntry = Record<string, ProfileValue>;
export type Profile = Record<string, ProfileEntry | ProfileEntry[]>;

export interface ProfileIssue {
  path: string;
  message: string;
}

const KNOWN_FIELDS: Record<string, Set<string>> = {};
for (const key of Object.keys(KEYS)) {
  const [group, field] = key.split('.') as [string, string];
  (KNOWN_FIELDS[group] ??= new Set()).add(field);
}

const DATE_RE = /^(\d{4})(-(\d{1,2}))?(-(\d{1,2}))?$/;

/**
 * 校验导入的 JSON。未知字段只提示不拦截，便于以后扩展；类型错误会拦截。
 */
export function validateProfile(input: unknown): { profile: Profile | null; errors: ProfileIssue[]; warnings: ProfileIssue[] } {
  const errors: ProfileIssue[] = [];
  const warnings: ProfileIssue[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { profile: null, errors: [{ path: '', message: '顶层必须是一个对象' }], warnings };
  }
  const profile = input as Record<string, unknown>;
  const checkEntry = (path: string, group: string, entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({ path, message: '应为对象' });
      return;
    }
    for (const [field, value] of Object.entries(entry)) {
      const p = `${path}.${field}`;
      if (!KNOWN_FIELDS[group]?.has(field)) warnings.push({ path: p, message: '不在字段目录中，填写时不会使用' });
      const ok = value == null || ['string', 'number', 'boolean'].includes(typeof value) || (Array.isArray(value) && value.every((v) => typeof v === 'string'));
      if (!ok) errors.push({ path: p, message: '只支持字符串、数字、布尔值或字符串数组' });
      if (typeof value === 'string' && /Date$/.test(field) && value && value !== '至今' && !DATE_RE.test(value)) {
        warnings.push({ path: p, message: '日期建议写成 YYYY-MM 或 YYYY-MM-DD，仍在进行的写“至今”' });
      }
    }
  };
  for (const [group, value] of Object.entries(profile)) {
    if (group.startsWith('$')) continue;
    if (!KNOWN_FIELDS[group]) {
      warnings.push({ path: group, message: '未知分组，填写时不会使用' });
      continue;
    }
    if (isListGroup(group)) {
      if (!Array.isArray(value)) {
        errors.push({ path: group, message: '应为数组，最近的经历放在最前面' });
        continue;
      }
      value.forEach((entry, i) => checkEntry(`${group}.${i}`, group, entry));
    } else {
      checkEntry(group, group, value);
    }
  }
  return { profile: errors.length ? null : (profile as Profile), errors, warnings };
}

export function entriesOf(profile: Profile, group: ListGroup): ProfileEntry[] {
  const list = profile[group];
  return Array.isArray(list) ? list : [];
}

/**
 * 按 key 和第几段取值。工作与实习互为补充：学生没有工作经历时，“工作经历”栏位使用实习经历，反之亦然。
 */
export function lookup(profile: Profile, key: string, index = 0): ProfileValue {
  const [group, field] = key.split('.') as [string, string];
  if (!isListGroup(group)) {
    const entry = profile[group];
    return entry && !Array.isArray(entry) ? entry[field] : undefined;
  }
  let list = entriesOf(profile, group);
  if (group === 'work' || group === 'internship') {
    const other = entriesOf(profile, group === 'work' ? 'internship' : 'work');
    list = [...list, ...other];
    // 实习字段名与工作字段名一致，可以直接混用。
  }
  return list[index]?.[field];
}

export function countEntries(profile: Profile): Partial<Record<ListGroup, number>> {
  const counts: Partial<Record<ListGroup, number>> = {};
  for (const g of LIST_GROUPS) counts[g] = entriesOf(profile, g).length;
  return counts;
}

export function summarize(profile: Profile) {
  const basics = profile.basics && !Array.isArray(profile.basics) ? profile.basics : {};
  return {
    name: String(basics.name ?? ''),
    counts: countEntries(profile),
  };
}
