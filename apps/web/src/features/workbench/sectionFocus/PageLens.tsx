import { t } from "@/i18n";
import type { Editor } from "@tiptap/core";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect } from "react";
import type { SectionReviewNoteKind } from "../../../api/client";
import type { LensNote } from "./FocusSheet";
import { unitLabel, type FocusUnit } from "./sectionModel";

/**
 * Paragraph analysis results laid over the resume page, after the job-lens
 * design: a coloured bar in the page margin beside each line with a note, the
 * problem words under a highlighter, and a column of note cards beside the
 * page joined to their lines. Nothing here sits on top of resume text or takes
 * pointer events from the editor; only the cards are clickable. Each paragraph
 * folds on its own: a folded one leaves a tab level with its first line.
 */

export type LensGroup = { unit: FocusUnit; notes: LensNote[] };

const LENS_GAP = 28;
const LENS_MAX_WIDTH = 300;
const LENS_MIN_WIDTH = 220;
/** Room kept free for the tool rail on the right edge of the canvas. */
const RAIL_ROOM = 84;
// While there are analyses the canvas sets aside RAIL_ROOM + LENS_GAP +
// LENS_MAX_WIDTH on its right (`.workbench-canvas.has-lens`, 412px), so the
// column stays on screen at any zoom.
const HEAD_HEIGHT = 30;
const CARD_HEIGHT = 58;
const CARD_GAP = 6;
const GROUP_GAP = 14;
const KINDS: SectionReviewNoteKind[] = ["missing", "wording", "structure"];
const highlightName = (kind: SectionReviewNoteKind) => `linkresume-section-lens-${kind}`;

const KIND_TEXT: Record<SectionReviewNoteKind, string> = {
  missing: "缺信息",
  wording: "表达",
  structure: "结构",
};

const STATUS_TEXT: Record<LensNote["status"], string> = {
  open: "待处理",
  done: "✓ 已采用",
  skipped: "已跳过",
  changed: "原句已改动",
};

type Box = { top: number; left: number; right: number; bottom: number };

function lineHost(editor: Editor, lineId: string) {
  return editor.view.dom.querySelector(`[data-resume-block-id="${CSS.escape(lineId)}"]`)?.closest("p, li, h1, h2, h3, h4") ?? null;
}

/** Top of a paragraph's first visible line. */
function unitTop(editor: Editor, unit: FocusUnit, origin: DOMRect) {
  let top = Infinity;
  editor.state.doc.nodesBetween(unit.from, Math.min(unit.to, editor.state.doc.content.size), (node, pos) => {
    if (Number.isFinite(top)) return false;
    if (!node.isTextblock) return true;
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement && dom.getBoundingClientRect().height > 0) top = dom.getBoundingClientRect().top - origin.top;
    return false;
  });
  return Number.isFinite(top) ? top : null;
}

function relative(box: DOMRect, origin: DOMRect): Box {
  return { top: box.top - origin.top, left: box.left - origin.left, right: box.right - origin.left, bottom: box.bottom - origin.top };
}

/** Text nodes of a line, without widget text such as the「+」button. */
function textNodes(host: Element) {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('[contenteditable="false"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

function quoteRanges(host: Element, quote: string): Range[] {
  const nodes = textNodes(host);
  const text = nodes.map((node) => node.data).join("");
  const start = text.indexOf(quote);
  if (!quote || start < 0) return [];
  const end = start + quote.length;
  const ranges: Range[] = [];
  let offset = 0;
  for (const node of nodes) {
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + node.data.length);
    if (from < to) {
      const range = document.createRange();
      range.setStart(node, from - offset);
      range.setEnd(node, to - offset);
      ranges.push(range);
    }
    offset += node.data.length;
  }
  return ranges;
}

export function PageLens({
  editor,
  groups,
  origin,
  scroller,
  collapsed,
  revision,
  onToggle,
  onOpenNote,
}: {
  editor: Editor;
  groups: LensGroup[];
  origin: DOMRect;
  scroller: HTMLElement | null;
  /** Paragraphs whose notes are folded away. */
  collapsed: ReadonlySet<string>;
  /** Changes whenever the document does, so the highlights follow the text. */
  revision: number;
  onToggle: (unitId: string, open: boolean) => void;
  onOpenNote: (unitId: string, noteId: string) => void;
}) {
  // Problem words under the highlighter, painted with the CSS Highlight API so
  // the editor DOM is never touched.
  const signature = groups.map((group) => (collapsed.has(group.unit.id) ? "-" : "") + group.notes.map((note) => `${note.id}:${note.status}:${note.quote}`).join(",")).join("|");
  useEffect(() => {
    const registry = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!registry || !HighlightCtor) return;
    const byKind = new Map<SectionReviewNoteKind, Range[]>(KINDS.map((kind) => [kind, []]));
    for (const group of groups) {
      if (collapsed.has(group.unit.id)) continue;
      for (const note of group.notes) {
          if (note.status !== "open" || !note.lineId || !note.quote) continue;
          const host = lineHost(editor, note.lineId);
          if (host) byKind.get(note.kind)?.push(...quoteRanges(host, note.quote));
        }
    }
    for (const kind of KINDS) {
      const ranges = byKind.get(kind) ?? [];
      if (ranges.length) registry.set(highlightName(kind), new HighlightCtor(...ranges));
      else registry.delete(highlightName(kind));
    }
    return () => { for (const kind of KINDS) registry.delete(highlightName(kind)); };
    // `signature` and `revision` stand for the notes and the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, signature, revision]);

  const paperElement = editor.view.dom.closest(".resume-paper") ?? editor.view.dom;
  const paper = relative(paperElement.getBoundingClientRect(), origin);
  const content = relative(editor.view.dom.getBoundingClientRect(), origin);
  const bounds = relative((scroller ?? editor.view.dom).getBoundingClientRect(), origin);
  // Next to the paper, or next to the scroll area once a zoomed paper overflows it.
  const lensLeft = Math.min(paper.right, bounds.right) + LENS_GAP;
  const lensWidth = Math.min(LENS_MAX_WIDTH, origin.width - RAIL_ROOM - lensLeft);
  const linkStart = Math.min(content.right + 6, bounds.right);
  const markerLeft = content.left - 14;
  const showMarkers = markerLeft >= bounds.left && markerLeft <= bounds.right;
  const hasColumn = lensWidth >= LENS_MIN_WIDTH;
  // Markers in the page margin and the card column, laid out top to bottom.
  const markers: Array<{ key: string; kind: SectionReviewNoteKind | "done"; top: number; height: number }> = [];
  const links: Array<{ key: string; kind: SectionReviewNoteKind | "done"; x1: number; y1: number; x2: number; y2: number }> = [];
  const placed: Array<{ group: LensGroup; top: number; folded: boolean; cards: Array<{ note: LensNote; top: number }> }> = [];
  let cursor = Math.max(paper.top, bounds.top) + 8;
  for (const group of groups) {
    // Header and tab sit level with the paragraph's first line, whether open or folded.
    const start = unitTop(editor, group.unit, origin);
    const folded = collapsed.has(group.unit.id);
    if (folded) {
      const top = Math.max(cursor, start ?? cursor);
      placed.push({ group, top, folded, cards: [] });
      cursor = top + HEAD_HEIGHT + GROUP_GAP;
      continue;
    }
    const lines = new Map<string, Box>();
    for (const note of group.notes) {
      if (!note.lineId || lines.has(note.lineId)) continue;
      const host = lineHost(editor, note.lineId);
      if (host) lines.set(note.lineId, relative(host.getBoundingClientRect(), origin));
    }
    const top = Math.max(cursor, start ?? cursor);
    let y = top + HEAD_HEIGHT;
    const cards: Array<{ note: LensNote; top: number }> = [];
    for (const note of group.notes) {
      const line = note.lineId ? lines.get(note.lineId) : undefined;
      const cardTop = Math.max(y, line ? line.top - 6 : y);
      cards.push({ note, top: cardTop });
      y = cardTop + CARD_HEIGHT + CARD_GAP;
      if (!line || note.status === "skipped" || note.status === "changed") continue;
      const kind = note.status === "done" ? "done" : note.kind;
      if (showMarkers) markers.push({ key: note.id, kind, top: line.top + 2, height: line.bottom - line.top - 4 });
      if (hasColumn) {
        links.push({ key: note.id, kind, x1: linkStart, y1: line.top + 11, x2: lensLeft, y2: cardTop + 20 });
      }
    }
    placed.push({ group, top, folded, cards });
    cursor = y + GROUP_GAP;
  }

  return (
    <div className="sf-lens" aria-label={t("段落分析结果")}>
      {markers.map((marker) => (
        <i key={marker.key} className={`sf-lens-marker is-${marker.kind}`} style={{ top: marker.top, left: markerLeft, height: marker.height }} aria-hidden="true" />
      ))}
      {hasColumn && (
        <>
          <svg className="sf-lens-links" aria-hidden="true" style={{ width: bounds.right, height: Math.max(cursor, bounds.bottom) }}>
            {links.map((link) => {
              const bend = Math.max(24, (link.x2 - link.x1) / 2);
              return (
                <g key={link.key} className={`is-${link.kind}`}>
                  <circle cx={link.x1} cy={link.y1} r={2.5} />
                  <path d={`M${link.x1},${link.y1} C${link.x1 + bend},${link.y1} ${link.x2 - bend},${link.y2} ${link.x2},${link.y2}`} />
                </g>
              );
            })}
          </svg>
          {placed.map(({ group, top, folded, cards }) => {
            const done = group.notes.filter((note) => note.status === "done").length;
            const pending = group.notes.filter((note) => note.status === "open").length;
            const name = group.unit.heading || group.unit.sectionLabel;
            if (folded) {
              return (
                <button
                  key={group.unit.id}
                  type="button"
                  className="sf-lens-tab"
                  style={{ top, left: lensLeft, maxWidth: lensWidth, height: HEAD_HEIGHT }}
                  title={t("展开「{name}」的分析", { name: unitLabel(group.unit) })}
                  aria-expanded={false}
                  onClick={() => onToggle(group.unit.id, true)}
                >
                  <i className="sf-ring" aria-hidden="true" />
                  <strong>{name}</strong>
                  {pending > 0 ? <b>{pending}</b> : <span>{t("{done} 已采用", { done })}</span>}
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
              );
            }
            return (
              <section key={group.unit.id} className="sf-lens-group" style={{ top, left: lensLeft, width: lensWidth }}>
                <header style={{ height: HEAD_HEIGHT }}>
                  <strong title={unitLabel(group.unit)}>{name}</strong>
                  <span>{t("{pending} 条待处理 · {done} 已采用", { pending, done })}</span>
                  <button type="button" className="sf-lens-fold" aria-expanded={true} title={t("收起「{name}」的分析", { name: unitLabel(group.unit) })} onClick={() => onToggle(group.unit.id, false)}>
                    {t("收起")}
                    <ChevronUp size={13} aria-hidden="true" />
                  </button>
                </header>
                {cards.map(({ note, top: cardTop }) => (
                  <button
                    key={note.id}
                    type="button"
                    className={`sf-lens-card is-${note.kind} is-${note.status}`}
                    style={{ top: cardTop - top, height: CARD_HEIGHT }}
                    onClick={() => onOpenNote(group.unit.id, note.id)}
                  >
                    <span className="sf-lens-card-head">
                      <i aria-hidden="true" />
                      <strong>{note.title}</strong>
                      <em>{note.status === "open" ? t(KIND_TEXT[note.kind]) : t(STATUS_TEXT[note.status])}</em>
                    </span>
                    <span className="sf-lens-card-detail">{note.detail}</span>
                  </button>
                ))}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
