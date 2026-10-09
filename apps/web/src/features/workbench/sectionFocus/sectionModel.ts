import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { SectionReviewContext, SectionReviewSection } from "../../../api/client";

/** One editable line (a bullet or a paragraph) inside a focus unit. */
export type FocusLine = { id: string; text: string };

/**
 * A focus unit is an entry (one job, project, school…) or, for sections that
 * have no entries such as skills, the section itself.
 */
export type FocusUnit = {
  id: string;
  kind: "entry" | "section";
  sectionLabel: string;
  heading: string;
  meta: string[];
  lines: FocusLine[];
  /** Document range from the heading to the end of the last line. */
  from: number;
  to: number;
};

const ANCHOR = "resumeBlockAnchor";
const LINE_ROLES = new Set(["list-item", "entry-block", "section-block", "block"]);
const META_ROLES = new Set(["entry-field", "row-block", "row-cell"]);
/** Table-like rows (date | company | role …). Recognised by node type: their anchors may carry no role. */
const ROW_TYPES = new Set(["resumeRow", "resumeMetaRow", "resumeTrioRow"]);

type Anchor = { blockId: string; role: string };

function anchorsOf(node: PMNode): Anchor[] {
  const anchors: Anchor[] = [];
  node.forEach((child) => {
    if (child.type.name !== ANCHOR) return;
    const { blockId, role } = child.attrs as { blockId?: unknown; role?: unknown };
    if (typeof blockId === "string" && typeof role === "string") anchors.push({ blockId, role });
  });
  return anchors;
}

/** Visible text of a textblock, skipping anchors and other leaf atoms. */
export function textblockText(node: PMNode): string {
  let text = "";
  node.forEach((child) => {
    if (child.isText) text += child.text ?? "";
  });
  return text;
}

const YEAR = String.raw`(?:19|20)\d{2}`;
const MONTH_NAME = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;
/** 2023.06, 2023-6, 2023/06, 2023年6月, 2023, Jun 2023. */
const DATE = String.raw`(?:${MONTH_NAME}\s*${YEAR}|${YEAR}(?:\s*[.\-/年]\s*\d{1,2}\s*月?)?)`;
const ONGOING = String.raw`(?:至今|现在|今|present|now|current)`;

/** A date range such as「2023.06 - 2023.09」「2019 - 2023」「2022年7月至今」or「Jun 2021 – Present」. */
const DATE_RANGE = new RegExp(String.raw`${DATE}\s*(?:[-–—~～至到]+|to)\s*(?:${DATE}|${ONGOING})`, "i");
const DATE_LIKE = new RegExp(String.raw`\d{4}\s*[.\-/年]\s*\d{1,2}|${DATE_RANGE.source}|至今|现在|present|now`, "i");

export function isDateLike(text: string) {
  return DATE_LIKE.test(text);
}

const SENTENCE_MARKS = /[。；;，,！!？?]/;

/**
 * A plain line that reads like an experience header: a date range plus a few
 * short fields (company, school, project, role), with no sentence punctuation.
 */
function isHeaderLine(text: string) {
  return text.length <= 80 && DATE_RANGE.test(text) && !SENTENCE_MARKS.test(text);
}

/**
 * A short line that can name the experience whose header follows it, such as
 * a project or school name on its own line above「2021.03 - 2022.01  负责人」.
 */
function isTitleLine(text: string) {
  return text.length > 0 && text.length <= 40 && !SENTENCE_MARKS.test(text) && !/[:：]$/.test(text) && !isDateLike(text);
}

/** Header fields, with the date range split out of a field that also holds a name. */
function headerCells(text: string) {
  return text
    .split(/\s{2,}|\t|\s*[|｜·•]\s*/)
    .flatMap((cell) => {
      const match = DATE_RANGE.exec(cell);
      if (!match || match[0].length === cell.trim().length) return [cell];
      return [cell.slice(0, match.index), match[0], cell.slice(match.index + match[0].length)];
    })
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function isHeaderFact(text: string) {
  return text.length > 0 && (isDateLike(text) || (text.length <= 24 && !/[。；;，,！!？?]/.test(text)));
}

/** Header details split into dates (shown on the right) and the rest. */
export function headerParts(unit: FocusUnit): { dates: string[]; details: string[] } {
  return {
    dates: unit.meta.filter(isDateLike),
    details: unit.meta.filter((item) => !isDateLike(item)),
  };
}

/**
 * Some resumes have no entries, or put several experiences under one entry:
 * each experience is a header (a table row, or a plain「date  name  role」line)
 * followed by its bullets. Such a header starts its own unit, so two
 * internships, schools or projects in one section are never merged. This holds
 * in every section; nothing here depends on the section's name.
 */
export function focusUnitsFromDoc(doc: PMNode): FocusUnit[] {
  const units: FocusUnit[] = [];
  let sectionLabel = "";
  let sectionUnit: FocusUnit | null = null;
  let entry: FocusUnit | null = null;
  let entryFromRow = false;
  // Units opened by a header row → the section they belong to.
  const rowUnits = new Map<string, string>();
  const sectionsWithEntries = new Set<string>();
  const entryBlocks = new Set<string>();
  // The line pushed just before the current block, when it was a plain line.
  let lastLine: { unit: FocusUnit; id: string; text: string; from: number } | null = null;

  /**
   * An experience header (a table row, or a plain「date  name  role」line).
   * It opens a new unit when the current one already has lines, or already has
   * its own date range (two schools listed without bullets), so experiences are
   * never merged, whether or not they sit under one entry. An untitled entry
   * takes the header as its title. Right after another header (a two-row
   * header) or a titled entry, it only adds to the header. A short title line
   * just above the header (a project name on its own line) becomes the title.
   */
  const header = (id: string, cells: string[], from: number, to: number) => {
    const current: FocusUnit | null = entry;
    let title: FocusLine | null = null;
    let titleFrom = from;
    const holder = current ?? sectionUnit;
    if (lastLine && holder && lastLine.unit === holder && holder.lines[holder.lines.length - 1]?.id === lastLine.id && isTitleLine(lastLine.text)) {
      title = holder.lines.pop()!;
      titleFrom = lastLine.from;
    }
    lastLine = null;
    const hasRange = (items: string[]) => items.some((item) => DATE_RANGE.test(item));
    if (sectionUnit && cells.length) {
      if (current === null || current.lines.length > 0 || (hasRange(current.meta) && hasRange(cells))) {
        entry = { id, kind: "entry", sectionLabel, heading: "", meta: [], lines: [], from: titleFrom, to };
        entryFromRow = true;
        rowUnits.set(id, sectionUnit.id);
        units.push(entry);
      } else if (!entryFromRow && !current.heading) {
        entryFromRow = true;
        rowUnits.set(current.id, sectionUnit.id);
      }
    }
    const target: FocusUnit | null = entry ?? sectionUnit;
    if (title && target && !target.heading) {
      target.heading = title.text;
      // The title now opens this unit, so the previous one ends before it.
      if (holder && holder !== target) holder.to = Math.max(holder.from, titleFrom - 1);
    } else if (title && holder) {
      holder.lines.push(title);
    }
    if (target) {
      target.meta.push(...cells);
      target.to = to;
    }
  };

  doc.descendants((node, pos) => {
    if (ROW_TYPES.has(node.type.name)) {
      const cells: string[] = [];
      let rowId: string | null = null;
      node.forEach((cell) => {
        if (!cell.isTextblock) return;
        rowId ??= anchorsOf(cell)[0]?.blockId ?? null;
        const value = textblockText(cell).trim();
        if (value) cells.push(value);
      });
      header(rowId ?? `row-at-${pos}`, cells, pos, pos + node.nodeSize);
      return false;
    }
    if (!node.isTextblock) return true;
    const anchors = anchorsOf(node);
    const end = pos + node.nodeSize;
    const role = (name: string) => anchors.find((anchor) => anchor.role === name);
    const text = textblockText(node).trim();
    const section = role("section");
    if (section) {
      sectionLabel = text;
      entry = null;
      entryFromRow = false;
      lastLine = null;
      sectionUnit = { id: section.blockId, kind: "section", sectionLabel: text, heading: text, meta: [], lines: [], from: pos, to: end };
      units.push(sectionUnit);
      return false;
    }
    const entryAnchor = role("entry");
    if (entryAnchor) {
      entry = { id: entryAnchor.blockId, kind: "entry", sectionLabel, heading: text, meta: [], lines: [], from: pos, to: end };
      entryFromRow = false;
      lastLine = null;
      if (sectionUnit) sectionsWithEntries.add(sectionUnit.id);
      units.push(entry);
      return false;
    }
    const line = anchors.find((anchor) => LINE_ROLES.has(anchor.role));
    if (line && line.role !== "list-item" && isHeaderLine(text)) {
      header(line.blockId, headerCells(text), pos, end);
      return false;
    }
    const target = line?.role === "section-block" && !entryFromRow ? sectionUnit : entry ?? sectionUnit;
    if (line && target) {
      if (line.role === "entry-block") entryBlocks.add(line.blockId);
      target.lines.push({ id: line.blockId, text });
      target.to = end;
      lastLine = line.role === "list-item" ? null : { unit: target, id: line.blockId, text, from: pos };
    } else if (target && anchors.some((anchor) => META_ROLES.has(anchor.role)) && text) {
      target.meta.push(text);
      target.to = end;
      lastLine = null;
    } else {
      lastLine = null;
    }
    return false;
  });
  for (const unit of units) {
    if (unit.kind !== "entry") continue;
    // Short facts right under an entry title (dates, degree, job title) belong
    // to its header, as long as real lines remain for the AI to work on.
    const facts = unit.lines.findIndex((item) => !(entryBlocks.has(item.id) && isHeaderFact(item.text)));
    if (facts > 0) {
      unit.meta.push(...unit.lines.slice(0, facts).map((item) => item.text));
      unit.lines = unit.lines.slice(facts);
    }
    if (!rowUnits.has(unit.id) || !unit.lines.length) continue;
    sectionsWithEntries.add(rowUnits.get(unit.id)!);
    if (unit.heading) continue;
    // The first cell that is not a date names the row, e.g. the company.
    const titleIndex = unit.meta.findIndex((item) => !isDateLike(item));
    unit.heading = titleIndex >= 0 ? unit.meta[titleIndex] : unit.meta[0] ?? "";
    unit.meta = unit.meta.filter((_, index) => index !== (titleIndex >= 0 ? titleIndex : 0));
  }
  return units.filter((unit) => (
    unit.kind === "entry"
      ? !rowUnits.has(unit.id) || unit.lines.length > 0
      // Sections are only focus units when they hold their own lines and no entries.
      : unit.lines.length > 0 && !sectionsWithEntries.has(unit.id)
  ));
}

export function unitLabel(unit: FocusUnit) {
  return unit.kind === "section" || !unit.sectionLabel
    ? unit.heading
    : `${unit.sectionLabel} · ${unit.heading}`;
}

export function unitText(unit: FocusUnit) {
  return [unit.heading, ...unit.meta, ...unit.lines.map((line) => line.text)].filter(Boolean).join("\n");
}

const LINE_LIMIT = 500;
const MAX_LINES = 20;
const SECTION_LIMIT = 4_000;
export const CONTEXT_LIMIT = 6;
const CONTEXT_TEXT_LIMIT = 1_500;
const CONTEXT_TOTAL_LIMIT = 6_000;

/**
 * Lines the AI may rewrite: sent in full (not truncated) and within the first
 * MAX_LINES. A truncated line could never pass the before-write text check.
 */
export function editableLineIds(unit: FocusUnit): Set<string> {
  const ids = new Set<string>();
  let budget = SECTION_LIMIT;
  for (const line of unit.lines.slice(0, MAX_LINES)) {
    if (budget <= 0) break;
    if (line.text.length <= Math.min(LINE_LIMIT, budget)) ids.add(line.id);
    budget -= Math.min(line.text.length, LINE_LIMIT, budget);
  }
  return ids;
}

export function sectionPayload(unit: FocusUnit): SectionReviewSection {
  let budget = SECTION_LIMIT;
  const lines: FocusLine[] = [];
  for (const line of unit.lines.slice(0, MAX_LINES)) {
    const text = line.text.slice(0, Math.min(LINE_LIMIT, budget));
    budget -= text.length;
    lines.push({ id: line.id, text });
    if (budget <= 0) break;
  }
  const heading = [unit.heading, ...unit.meta].filter(Boolean).join(" · ").slice(0, 200);
  return { entry_id: unit.id, heading, lines };
}

/** Default context: the other units of the resume, in document order. */
export function defaultContextIds(units: FocusUnit[], focusId: string): string[] {
  return units
    .filter((unit) => unit.id !== focusId && unit.lines.some((line) => line.text.trim()))
    .slice(0, CONTEXT_LIMIT)
    .map((unit) => unit.id);
}

export function contextPayload(units: FocusUnit[], ids: string[]): SectionReviewContext[] {
  let budget = CONTEXT_TOTAL_LIMIT;
  const context: SectionReviewContext[] = [];
  for (const id of ids.slice(0, CONTEXT_LIMIT)) {
    const unit = units.find((item) => item.id === id);
    if (!unit || budget <= 0) continue;
    const text = unitText(unit).slice(0, Math.min(CONTEXT_TEXT_LIMIT, budget));
    budget -= text.length;
    context.push({ id: unit.id, label: unitLabel(unit).slice(0, 120), text });
  }
  return context;
}

/* ── ⌘K：把一句话在本地匹配到段落 ───────────────────────────── */

function keywords(unit: FocusUnit): string[] {
  const parts = [unit.heading, ...unit.meta]
    .join(" ")
    .split(/[\s·•|｜,，、:：/（）()\-–—]+/)
    .map((part) => part.replace(/^(组织|角色|地点|开始|结束|学位|专业|链接)$/, "").trim())
    .filter((part) => part.length >= 2 && !/^\d/.test(part));
  return [...new Set(parts)];
}

export type TargetMatch =
  | { kind: "unique"; unit: FocusUnit }
  | { kind: "ambiguous"; candidates: FocusUnit[] }
  | { kind: "none"; candidates: FocusUnit[] };

export function matchTarget(query: string, units: FocusUnit[]): TargetMatch {
  const text = query.toLowerCase();
  const scored = units
    .map((unit) => ({
      unit,
      score: keywords(unit).reduce((sum, word) => {
        const lower = word.toLowerCase();
        if (text.includes(lower)) return sum + 2;
        // Allow a 2-character prefix such as「美团」of「美团点评」.
        return lower.length > 2 && text.includes(lower.slice(0, 2)) ? sum + 1 : sum;
      }, 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { kind: "none", candidates: units };
  const top = scored.filter((item) => item.score === scored[0].score);
  return top.length === 1
    ? { kind: "unique", unit: top[0].unit }
    : { kind: "ambiguous", candidates: top.map((item) => item.unit) };
}

/** 「第 2 条」→ index 1 (0-based); null when the sentence names no line. */
export function lineIndexFromText(text: string): number | null {
  const digits = text.match(/第\s*(\d+)\s*[条句点行]/);
  if (digits) return Number(digits[1]) - 1;
  const chinese = text.match(/第\s*([一二三四五六七八九十])\s*[条句点行]/);
  if (!chinese) return null;
  return "一二三四五六七八九十".indexOf(chinese[1]);
}

/* ── 写入与撤销：先比对文本，不一致就不写 ─────────────────── */

export type LineEdit = { lineId: string; before: string; after: string };
export type EditResult = "applied" | "conflict" | "missing";

type LocatedLine = { node: PMNode; pos: number };

function findLine(doc: PMNode, lineId: string): LocatedLine | null {
  const found: LocatedLine[] = [];
  doc.descendants((node, pos) => {
    if (found.length) return false;
    if (!node.isTextblock) return true;
    if (anchorsOf(node).some((anchor) => anchor.blockId === lineId && LINE_ROLES.has(anchor.role))) {
      found.push({ node, pos });
    }
    return false;
  });
  return found[0] ?? null;
}

export function currentLineText(doc: PMNode, lineId: string): string | null {
  const line = findLine(doc, lineId);
  return line ? textblockText(line.node) : null;
}

/**
 * Replace the visible text of a line while keeping its anchors. Returns the
 * transaction to dispatch, or the reason it must not be written.
 */
export function replaceLineText(
  state: EditorState,
  lineId: string,
  expected: string,
  next: string,
): Transaction | Exclude<EditResult, "applied"> {
  const line = findLine(state.doc, lineId);
  if (!line) return "missing";
  if (textblockText(line.node).trim() !== expected.trim()) return "conflict";
  // Rebuild the content as「anchors + new text」so no anchor is lost, wherever
  // it sat inside the line.
  const anchors: PMNode[] = [];
  line.node.forEach((child) => {
    if (child.type.name === ANCHOR) anchors.push(child);
  });
  const content = next ? [...anchors, state.schema.text(next)] : anchors;
  const tr = state.tr.replaceWith(line.pos + 1, line.pos + line.node.nodeSize - 1, Fragment.fromArray(content));
  return tr.setMeta("linkresume:sectionFocus", { lineId });
}
