// 简历中的经历段数多于页面上的输入块时，点击对应模块的“添加”按钮补齐。
// 只在站点配置提供了经历容器和模块标题选择器时执行：数不清已有块数时宁可不点，交给用户手动添加。
import { realClick, sleep, isVisible } from '../writer/dom.js';
import type { SiteConfig } from '../writer/types';
import type { ListGroup } from '../profile/keys';
import { cleanText } from './scanner';

const MODULE_PATTERNS: [ListGroup, RegExp][] = [
  ['internship', /实习|internship/i],
  ['education', /教育|学历|学习经历|education/i],
  ['work', /工作|职业|employment|work experience/i],
  ['projects', /项目|project/i],
  ['awards', /获奖|奖项|荣誉|award/i],
  ['certificates', /证书|certificate/i],
  ['languages', /语言|外语|language/i],
  ['family', /家庭|家属|family/i],
];
const ADD_TEXT = /(添加|新增|增加|\badd\b)/i;
const NEVER_CLICK = /附件|文件|照片|图片|上传|作品|attach|upload|file|photo/i;
const MAX_CLICKS_PER_MODULE = 5;

export function moduleOf(title: string): ListGroup | null {
  for (const [group, re] of MODULE_PATTERNS) if (re.test(title)) return group;
  return null;
}

interface ModuleBlock {
  group: ListGroup;
  title: Element;
  next: Element | null;
}

function modules(site: SiteConfig): ModuleBlock[] {
  const titles = Array.from(document.querySelectorAll(site.level1_class!)).filter(isVisible);
  return titles
    .map((title, i) => ({ group: moduleOf(cleanText(title.textContent)), title, next: titles[i + 1] ?? null }))
    .filter((m): m is ModuleBlock => m.group != null);
}

const after = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const within = (el: Element, m: ModuleBlock) => after(m.title, el) && (!m.next || after(el, m.next));

function countGroups(site: SiteConfig, m: ModuleBlock) {
  return Array.from(document.querySelectorAll(site.group_class!)).filter((g) => isVisible(g) && within(g, m)).length;
}

function findAddButton(m: ModuleBlock): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"], [class*="add" i]')).filter((el) => {
    const text = cleanText(el.textContent);
    if (!text || text.length > 20 || !ADD_TEXT.test(text) || NEVER_CLICK.test(text)) return false;
    if (!isVisible(el)) return false;
    // 按钮文字自带模块名时必须与当前模块一致；否则要求按钮位于该模块范围内
    const named = moduleOf(text);
    if (named) return named === m.group;
    return within(el, m) || m.title.contains(el);
  });
  // 优先选模块范围内、最靠近末尾的按钮
  const inside = candidates.filter((c) => within(c, m) || m.title.contains(c));
  return (inside.length ? inside[inside.length - 1] : candidates[0]) ?? null;
}

export interface AddRowsReport {
  group: ListGroup;
  had: number;
  wanted: number;
  added: number;
  note?: string;
}

export async function addMissingRows(site: SiteConfig | null, wanted: Partial<Record<ListGroup, number>>, signal?: AbortSignal): Promise<AddRowsReport[]> {
  if (!site?.group_class || !site.level1_class) return [];
  const reports: AddRowsReport[] = [];
  const seen = new Set<ListGroup>();
  for (const m of modules(site)) {
    if (signal?.aborted) break;
    // 学生没有工作经历时，“工作经历”模块会用实习经历来填，所以按两者之和补齐
    const target =
      m.group === 'work' || m.group === 'internship' ? (wanted.work ?? 0) + (wanted.internship ?? 0) : (wanted[m.group] ?? 0);
    if (seen.has(m.group) || target <= 0) continue;
    seen.add(m.group);
    const had = countGroups(site, m);
    if (had >= target) continue;
    const report: AddRowsReport = { group: m.group, had, wanted: target, added: 0 };
    for (let i = 0; i < Math.min(target - had, MAX_CLICKS_PER_MODULE); i++) {
      if (signal?.aborted) break;
      const button = findAddButton(m);
      if (!button) {
        report.note = '没有找到“添加”按钮';
        break;
      }
      const before = countGroups(site, m);
      await realClick(button, 400);
      await sleep(200);
      if (countGroups(site, m) <= before) {
        report.note = '点击“添加”后经历块没有增加，已停止';
        break;
      }
      report.added++;
    }
    reports.push(report);
  }
  return reports;
}
