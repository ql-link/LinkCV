import { t } from "@/i18n";
import type { Editor } from "@tiptap/core";
import { useEffect } from "react";
import type { SectionReviewNoteKind } from "../../../api/client";
import type { LensNote } from "./FocusSheet";
import { unitLabel, type FocusUnit } from "./sectionModel";

/**
 * Paragraph analysis results laid over the resume page, after the job-lens
 * design: a coloured bar in the page margin beside each line with a note, the
 * problem words under a highlighter, and a column of note cards beside the
 * page joined to their lines. Nothing here sits on top of resume text or takes
 * pointer events from the editor; only the cards are clickable.
 */

export type LensGroup = { unit: FocusUnit; notes: LensNote[] };

const LENS_GAP = 28;
const LENS_MAX_WIDTH = 300;
const LENS_MIN_WIDTH = 220;
/** Room kept free for the tool rail on the right edge of the canvas. */
const RAIL_ROOM = 84;
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
  open,
  revision,
  onToggle,
  onOpenNote,
}: {
  editor: Editor;
  groups: LensGroup[];
  origin: DOMRect;
  scroller: HTMLElement | null;
  open: boolean;
  /** Changes whenever the document does, so the highlights follow the text. */
  revision: number;
  onToggle: (open: boolean) => void;
  onOpenNote: (unitId: string, noteId: string) => void;
}) {
  // Problem words under the highlighter, painted with the CSS Highlight API so
  // the editor DOM is never touched.
  const signature = groups.map((group) => group.notes.map((note) => `${note.id}:${note.status}:${note.quote}`).join(",")).join("|");
  useEffect(() => {
    const registry = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!registry || !HighlightCtor) return;
    const byKind = new Map<SectionReviewNoteKind, Range[]>(KINDS.map((kind) => [kind, []]));
    if (open) {
      for (const group of groups) {
        for (const note of group.notes) {
          if (note.status !== "open" || !note.lineId || !note.quote) continue;
          const host = lineHost(editor, note.lineId);
          if (host) byKind.get(note.kind)?.push(...quoteRanges(host, note.quote));
        }
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
  }, [editor, open, signature, revision]);

  const paperElement = editor.view.dom.closest(".resume-paper") ?? editor.view.dom;
  const paper = relative(paperElement.getBoundingClientRect(), origin);
  const content = relative(editor.view.dom.getBoundingClientRect(), origin);
  const bounds = relative((scroller ?? editor.view.dom).getBoundingClientRect(), origin);
  const lensLeft = paper.right + LENS_GAP;
  const lensWidth = Math.min(LENS_MAX_WIDTH, bounds.right - RAIL_ROOM - lensLeft);
  const hasColumn = lensWidth >= LENS_MIN_WIDTH;
  const openCount = groups.reduce((sum, group) => sum + group.notes.filter((note) => note.status === "open").length, 0);

  if (!open) {
    if (!hasColumn) return null;
    return (
      <button type="button" className="sf-lens-pill" style={{ top: Math.max(paper.top, bounds.top) + 8, left: lensLeft }} onClick={() => onToggle(true)}>
        <i className="sf-ring" aria-hidden="true" />
        {t("段落分析")}
        {openCount > 0 && <b>{openCount}</b>}
      </button>
    );
  }

  // Markers in the page margin and the card column, laid out top to bottom.
  const markers: Array<{ key: string; kind: SectionReviewNoteKind | "done"; top: number; height: number }> = [];
  const links: Array<{ key: string; kind: SectionReviewNoteKind | "done"; x1: number; y1: number; x2: number; y2: number }> = [];
  const placed: Array<{ group: LensGroup; top: number; cards: Array<{ note: LensNote; top: number }> }> = [];
  let cursor = Math.max(paper.top, bounds.top) + 8;
  for (const group of groups) {
    const lines = new Map<string, Box>();
    for (const note of group.notes) {
      if (!note.lineId || lines.has(note.lineId)) continue;
      const host = lineHost(editor, note.lineId);
      if (host) lines.set(note.lineId, relative(host.getBoundingClientRect(), origin));
    }
    const first = [...lines.values()].reduce((min, box) => Math.min(min, box.top), Infinity);
    const top = Math.max(cursor, Number.isFinite(first) ? first - HEAD_HEIGHT : cursor);
    let y = top + HEAD_HEIGHT;
    const cards: Array<{ note: LensNote; top: number }> = [];
    for (const note of group.notes) {
      const line = note.lineId ? lines.get(note.lineId) : undefined;
      const cardTop = Math.max(y, line ? line.top - 6 : y);
      cards.push({ note, top: cardTop });
      y = cardTop + CARD_HEIGHT + CARD_GAP;
      if (!line || note.status === "skipped" || note.status === "changed") continue;
      const kind = note.status === "done" ? "done" : note.kind;
      markers.push({ key: note.id, kind, top: line.top + 2, height: line.bottom - line.top - 4 });
      if (hasColumn) {
        links.push({ key: note.id, kind, x1: content.right + 6, y1: line.top + 11, x2: lensLeft, y2: cardTop + 20 });
      }
    }
    placed.push({ group, top, cards });
    cursor = y + GROUP_GAP;
  }

  return (
    <div className="sf-lens" aria-label={t("段落分析结果")}>
      {markers.map((marker) => (
        <i key={marker.key} className={`sf-lens-marker is-${marker.kind}`} style={{ top: marker.top, left: content.left - 14, height: marker.height }} aria-hidden="true" />
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
          {placed.map(({ group, top, cards }) => {
            const done = group.notes.filter((note) => note.status === "done").length;
            const pending = group.notes.filter((note) => note.status === "open").length;
            return (
              <section key={group.unit.id} className="sf-lens-group" style={{ top, left: lensLeft, width: lensWidth }}>
                <header style={{ height: HEAD_HEIGHT }}>
                  <strong title={unitLabel(group.unit)}>{group.unit.heading || group.unit.sectionLabel}</strong>
                  <span>{t("{pending} 条待处理 · {done} 已采用", { pending, done })}</span>
                  {group === placed[0].group && (
                    <button type="button" className="sf-link sf-muted" onClick={() => onToggle(false)}>{t("收起")}</button>
                  )}
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
