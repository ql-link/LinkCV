import { t } from "@/i18n";
import type { Editor } from "@tiptap/core";
import { Check, ChevronDown, RefreshCw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  api,
  ApiRequestError,
  type JobDescriptionSummary,
  type SectionReviewAnalyzeResult,
  type SectionReviewItem,
  type SectionReviewItemUpdate,
  type SectionReviewRecord,
  type SectionReviewNote,
  type SectionReviewNoteKind,
  type SectionReviewQuestion,
  type SectionReviewWritingMethod,
  type SectionReviewVariant,
} from "../../../api/client";
import {
  CONTEXT_LIMIT,
  contextPayload,
  currentLineText,
  editableLineIds,
  headerParts,
  lineIndexFromText,
  replaceLineText,
  sectionPayload,
  unitLabel,
  type FocusUnit,
  type LineEdit,
} from "./sectionModel";
import { diffText } from "./textDiff";

/** How long the reading cursor rests on each line while the analysis runs. */
const READ_STEP = 1100;

export type AppliedEdit = LineEdit & {
  id: string;
  unitId: string;
  kind: SectionReviewNoteKind | "ask";
  title: string;
};

/** `itemId` opens the sheet on one saved suggestion, e.g. from the page annotations. */
export type FocusRequest = { unitId: string; intent: string; itemId?: string };

/** How the paragraph is judged: a fixed writing method, or the general standard. */
type Style = { kind: "general" } | { kind: "method"; method: SectionReviewWritingMethod };
/** The job the resume is aimed at; optional, applied on top of the style. */
type TargetJob = { id: string; label: string };

/** Fixed analysis styles; STAR is the default. */
const STYLES: Array<{ style: Style; label: string; hint: string }> = [
  { style: { kind: "method", method: "star" }, label: "STAR 法则", hint: "情境 · 任务 · 行动 · 结果" },
  { style: { kind: "method", method: "xyz" }, label: "XYZ 公式", hint: "以 Y 衡量的成果 X，通过 Z 实现" },
  { style: { kind: "method", method: "car" }, label: "CAR 法则", hint: "挑战 · 行动 · 结果，适合紧凑篇幅" },
  { style: { kind: "general" }, label: "通用写作标准", hint: "动词开头、结果量化、具体简洁、不重复" },
];
const DEFAULT_STYLE: Style = { kind: "method", method: "star" };

const sameStyle = (a: Style, b: Style) => a.kind === b.kind && (a.kind !== "method" || (b.kind === "method" && a.method === b.method));
const styleLabel = (style: Style) => t(STYLES.find((item) => sameStyle(item.style, style))?.label ?? "STAR 法则");
type Draft = { variants: SectionReviewVariant[]; missing: string[]; baseText: string; lineId: string };
type ItemStatus = "todo" | "asking" | "loading" | "pending" | "done" | "skipped" | "stale" | "error";
type Item = {
  id: string;
  number: number | null;
  kind: SectionReviewNoteKind | "ask";
  note: SectionReviewNote | null;
  instruction: string;
  /** Drafted from the answers to the "too little content" questions. */
  fromDraft?: boolean;
  lineId: string | null;
  status: ItemStatus;
  qIndex: number;
  answers: string[];
  draft: Draft | null;
  selected: number;
  message: string | null;
  edit: LineEdit | null;
};

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; result: SectionReviewAnalyzeResult; baseLines: Record<string, string>; reviewId: string };

/**
 * A finished analysis of one paragraph. Saved on the server, so reopening the
 * paragraph, even after a reload, does not call the model again.
 */
export type SheetSnapshot = {
  phase: Extract<Phase, { kind: "ready" }>;
  items: Item[];
  activeId: string | null;
  style: Style;
  job: TargetJob | null;
  intent: string;
  contextIds: string[];
  draftAnswers: string[];
  runId: number;
};

export type LensNote = {
  id: string;
  number: number | null;
  kind: SectionReviewNoteKind;
  title: string;
  detail: string;
  quote: string;
  lineId: string | null;
  /** `changed`: the line was edited after the analysis, so the note may no longer apply. */
  status: "open" | "done" | "skipped" | "changed";
};

/** Analysis results of one paragraph, as shown on the resume page. */
export function snapshotNotes(snapshot: SheetSnapshot, editor: Editor): LensNote[] {
  return restoreItems(snapshot.items, editor).flatMap((item): LensNote[] => {
    if (!item.note) return [];
    const lineId = item.note.line_id ?? item.lineId;
    const current = lineId ? currentLineText(editor.state.doc, lineId) : null;
    if (lineId && current === null) return [];
    const base = lineId ? snapshot.phase.baseLines[lineId] : undefined;
    const status = item.status === "done" ? "done"
      : item.status === "skipped" ? "skipped"
        : base !== undefined && current !== base ? "changed" : "open";
    return [{ id: item.id, number: item.number, kind: item.kind as SectionReviewNoteKind, title: item.note.title, detail: item.note.detail, quote: item.note.quote, lineId, status }];
  });
}

/** Bring a saved snapshot in line with the document as it is now. */
function restoreItems(items: Item[], editor: Editor): Item[] {
  return items.map((item) => {
    // A request cut off by closing the sheet goes back to where it started.
    if (item.status === "loading") return { ...item, status: item.draft ? "pending" : "todo" };
    // Undone from the recap card or edited by hand since: no longer applied.
    if (item.status === "done" && item.edit && currentLineText(editor.state.doc, item.edit.lineId) !== item.edit.after) {
      return { ...item, status: item.draft ? "pending" : "todo", edit: null };
    }
    return item;
  });
}

/** A saved item as a working item of the sheet. */
function itemFromServer(item: SectionReviewItem, number: number | null): Item {
  const fromDraft = item.kind === "draft";
  return {
    id: item.id,
    number,
    kind: item.kind === "draft" ? "missing" : item.kind,
    note: item.note,
    instruction: item.instruction || (fromDraft ? t("按你的回答起草") : ""),
    fromDraft,
    lineId: item.line_id,
    status: item.status,
    qIndex: item.question_index,
    answers: item.answers,
    draft: item.draft
      ? { variants: item.draft.variants, missing: item.draft.missing, baseText: item.draft.base_text, lineId: item.draft.line_id }
      : null,
    selected: item.selected_index,
    message: null,
    edit: item.edit ? { lineId: item.edit.line_id, before: item.edit.before, after: item.edit.after } : null,
  };
}

/** Saved items in order; notes and drafts are numbered, the user's own requests are not. */
function itemsFromServer(items: SectionReviewItem[]): Item[] {
  let number = 0;
  return items.map((item) => itemFromServer(item, item.kind === "ask" ? null : ++number));
}

/** A saved analysis, as loaded when the editor opens. */
export function snapshotFromRecord(record: SectionReviewRecord): SheetSnapshot {
  const items = itemsFromServer(record.items);
  const reference = record.reference;
  const jobId = record.job_id ?? (reference.kind === "job" ? reference.job_id : null);
  // The label reads「风格 · 公司 · 职位」; the job part is what the picker shows.
  const jobLabel = record.result.reference_label.split(" · ").slice(1).join(" · ");
  return {
    phase: { kind: "ready", result: record.result, baseLines: record.base_lines, reviewId: record.id },
    items,
    activeId: items.find((item) => item.status !== "done" && item.status !== "skipped")?.id ?? null,
    style: reference.kind === "method" ? { kind: "method", method: reference.method } : { kind: "general" },
    job: jobId ? { id: jobId, label: jobLabel || t("目标岗位") } : null,
    intent: record.intent,
    contextIds: record.context_ids,
    draftAnswers: record.items.find((item) => item.kind === "draft")?.answers ?? [],
    runId: 0,
  };
}

/** Notes whose target line the AI may not rewrite are left out, unless already applied. */
function rewritableItems(items: Item[], unit: FocusUnit) {
  const editableIds = editableLineIds(unit);
  const fallbackLine = unit.lines.find((line) => editableIds.has(line.id))?.id ?? null;
  return items.filter((item) => {
    if (!item.note || item.status === "done") return true;
    const target = item.note.proposal?.line_id ?? item.note.line_id ?? fallbackLine;
    return target !== null && editableIds.has(target);
  });
}

/** Whether the paragraph changed after the analysis, other than through changes applied here. */
function changedSinceAnalysis(unit: FocusUnit, baseLines: Record<string, string>, items: Item[]) {
  const applied = new Map(items.flatMap((item) => (item.status === "done" && item.edit ? [[item.edit.lineId, item.edit.after] as const] : [])));
  const ids = Object.keys(baseLines);
  if (ids.length !== unit.lines.length) return true;
  return unit.lines.some((line) => !(line.id in baseLines) || line.text !== (applied.get(line.id) ?? baseLines[line.id]));
}

const KIND_LABEL: Record<Item["kind"], string> = {
  missing: "MISSING",
  wording: "WORDING",
  structure: "STRUCTURE",
  ask: "YOUR ASK",
};

const STATUS_LABEL: Record<ItemStatus, string> = {
  todo: "未处理",
  asking: "追问中",
  loading: "生成中",
  pending: "待确认",
  done: "✓ 已采用",
  skipped: "已跳过",
  stale: "已过期",
  error: "未完成",
};

function errorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.message === "LLM_MODEL_NOT_CONFIGURED") {
    return t("AI 精修暂不可用：管理员还没有配置模型。");
  }
  if (error instanceof ApiRequestError && error.message === "SECTION_REVIEW_NOT_FOUND") {
    return t("这条建议已被新的分析替换，请在新的建议里继续。");
  }
  if (error instanceof ApiRequestError && error.message === "SECTION_REVIEW_ITEM_APPLIED") return t("这一条已经采用，不再生成新版本。");
  if (error instanceof ApiRequestError && error.message === "SECTION_REVIEW_ITEM_LIMIT") {
    return t("这一段的建议已经很多了，先处理一些或重新分析，再继续提要求。");
  }
  if (error instanceof ApiRequestError && error.status === 404) return t("没有找到这份简历或所选岗位。");
  return t("这次没有完成，原文没有任何改动，可以重试。");
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Render text with the problem quotes highlighted by note kind. */
function QuotedText({ text, quotes }: { text: string; quotes: Array<{ quote: string; kind: SectionReviewNoteKind }> }) {
  const marks: Array<{ start: number; end: number; kind: SectionReviewNoteKind }> = [];
  for (const { quote, kind } of quotes) {
    if (!quote) continue;
    const start = text.indexOf(quote);
    if (start < 0 || marks.some((mark) => start < mark.end && start + quote.length > mark.start)) continue;
    marks.push({ start, end: start + quote.length, kind });
  }
  marks.sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let offset = 0;
  marks.forEach((mark, index) => {
    if (mark.start > offset) parts.push(text.slice(offset, mark.start));
    parts.push(<mark key={index} className={`sf-hl sf-hl-${mark.kind}`}>{text.slice(mark.start, mark.end)}</mark>);
    offset = mark.end;
  });
  if (offset < text.length) parts.push(text.slice(offset));
  return <>{parts}</>;
}

/** New text with additions in green; deletions only when `withDeleted`. */
export function DiffText({ before, after, withDeleted = false, risky = [] }: { before: string; after: string; withDeleted?: boolean; risky?: string[] }) {
  const segments = diffText(before, after);
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "del") return withDeleted ? <del key={index} className="sf-del">{segment.text}</del> : null;
        if (segment.kind === "add") {
          const isRisky = risky.some((term) => segment.text.includes(term));
          return <mark key={index} className={`sf-add${isRisky ? " is-risky" : ""}`}>{segment.text}</mark>;
        }
        return <Fragment key={index}>{segment.text}</Fragment>;
      })}
    </>
  );
}

export function FocusSheet({
  editor,
  resumeId,
  units,
  request,
  index,
  cached,
  onSave,
  onClose,
  onNavigate,
}: {
  editor: Editor;
  resumeId: string;
  units: FocusUnit[];
  request: FocusRequest;
  index: number;
  cached: SheetSnapshot | null;
  onSave: (unitId: string, snapshot: SheetSnapshot) => void;
  onClose: (edits: AppliedEdit[]) => void;
  onNavigate: (unitId: string, edits: AppliedEdit[]) => void;
}) {
  const unit = units.find((item) => item.id === request.unitId);
  const [restored] = useState(() => (cached && unit ? { ...cached, items: rewritableItems(restoreItems(cached.items, editor), unit) } : null));
  // A new instruction from ⌘K asks for a fresh analysis even when one is saved.
  const [autoRun] = useState(() => !restored || Boolean(request.intent.trim()));
  const [style, setStyle] = useState<Style>(restored?.style ?? DEFAULT_STYLE);
  const [job, setJob] = useState<TargetJob | null>(restored?.job ?? null);
  const [intent, setIntent] = useState(request.intent.trim() ? request.intent : restored?.intent ?? "");
  const [contextIds, setContextIds] = useState<string[]>(() => restored?.contextIds.filter((id) => units.some((item) => item.id === id)) ?? (
    units.filter((item) => item.id !== request.unitId && item.lines.some((line) => line.text.trim())).slice(0, CONTEXT_LIMIT).map((item) => item.id)
  ));
  const [phase, setPhase] = useState<Phase>(restored?.phase ?? { kind: "loading" });
  const [items, setItems] = useState<Item[]>(restored?.items ?? []);
  const [activeId, setActiveId] = useState<string | null>(() => (
    request.itemId && restored?.items.some((item) => item.id === request.itemId) ? request.itemId : restored?.activeId ?? null
  ));
  const [askText, setAskText] = useState("");
  const [askLineId, setAskLineId] = useState<string | null>(null);
  // The user request being reworded in the ask bar; it is set aside once the new one is sent.
  const [revisingId, setRevisingId] = useState<string | null>(null);
  const askInput = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<JobDescriptionSummary[] | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [draftAnswers, setDraftAnswers] = useState<string[]>(restored?.draftAnswers ?? []);
  const controllers = useRef(new Set<AbortController>());
  // Latest rewrite per item; an older reply must not overwrite a newer one.
  const itemRequests = useRef(new Map<string, AbortController>());
  const editable = useMemo(() => (unit ? editableLineIds(unit) : new Set<string>()), [unit]);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const runIdRef = useRef(restored?.runId ?? 0);
  // Time spent on the current analysis: paces the reading cursor and the status line.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (phase.kind !== "loading") return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 400);
    return () => window.clearInterval(timer);
  }, [phase.kind]);
  const waited = Math.floor(elapsed / 1000);
  // The line the reading cursor rests on; it walks the paragraph line by line.
  const readingLine = phase.kind === "loading" && unit?.lines.length ? Math.floor(elapsed / READ_STEP) % unit.lines.length : -1;
  // Changes applied in an earlier visit were already shown in that visit's recap.
  const reported = useRef(new Set(restored?.items.flatMap((item) => (item.status === "done" && item.edit ? [item.edit] : [])) ?? []));

  const track = useCallback(() => {
    const controller = new AbortController();
    controllers.current.add(controller);
    return controller;
  }, []);
  const release = useCallback((controller: AbortController) => { controllers.current.delete(controller); }, []);

  const edits = useMemo<AppliedEdit[]>(() => items.flatMap((item) => (
    item.edit && item.status === "done" && !reported.current.has(item.edit)
      ? [{ ...item.edit, id: item.id, unitId: request.unitId, kind: item.kind, title: item.note?.title ?? item.instruction }]
      : []
  )), [items, request.unitId]);

  const close = useCallback(() => {
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    onClose(edits);
  }, [edits, onClose]);

  const analyze = useCallback(async () => {
    if (!unit) return;
    const runId = ++runIdRef.current;
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    const controller = track();
    setPhase({ kind: "loading" });
    setActiveId(null);
    const section = sectionPayload(unit);
    try {
      const result = await api.analyzeResumeSection(resumeId, {
        section,
        context: contextPayload(units, contextIds),
        intent: intent.trim() || null,
        reference: style,
        job_id: job?.id ?? null,
      }, controller.signal);
      if (runId !== runIdRef.current) return;
      const baseLines = Object.fromEntries(section.lines.map((line) => [line.id, line.text]));
      // Applied changes survive a re-analysis on the server, so they stay listed and undoable.
      const next = rewritableItems(itemsFromServer(result.review.items), unit);
      const shown = new Set(next.flatMap((item) => (item.note ? [item.note.id] : [])));
      const { review, ...analysis } = result;
      setPhase({
        kind: "ready",
        result: { ...analysis, notes: analysis.notes.filter((note) => shown.has(note.id)) },
        baseLines,
        reviewId: review.id,
      });
      setItems(next);
      setActiveId(next.find((item) => item.status !== "done")?.id ?? null);
    } catch (error) {
      if (isAbort(error) || runId !== runIdRef.current) return;
      setPhase({ kind: "error", message: errorMessage(error) });
    } finally {
      release(controller);
    }
  }, [unit, units, resumeId, contextIds, intent, style, job, track, release]);

  useEffect(() => {
    if (autoRun) void analyze();
    const active = controllers.current;
    return () => { active.forEach((controller) => controller.abort()); };
    // Only the first analysis runs automatically, and only when nothing is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save the latest finished analysis when the sheet goes away (close or switching paragraphs).
  const snapshot = useRef<SheetSnapshot | null>(null);
  useEffect(() => {
    snapshot.current = phase.kind === "ready"
      ? { phase, items, activeId, style, job, intent, contextIds, draftAnswers, runId: runIdRef.current }
      : null;
  }, [phase, items, activeId, style, job, intent, contextIds, draftAnswers]);
  useEffect(() => () => {
    if (snapshot.current) onSave(request.unitId, snapshot.current);
    // Saved once, on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // An open dropdown handles its own keys, Escape included.
      if ((event.target as HTMLElement | null)?.closest?.('[role="menu"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const list = itemsRef.current;
        if (!list.length) return;
        event.preventDefault();
        const current = list.findIndex((item) => item.id === activeId);
        const next = event.key === "ArrowDown" ? Math.min(list.length - 1, current + 1) : Math.max(0, current - 1);
        setActiveId(list[next].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, close]);

  const patch = (id: string, update: Partial<Item> | ((item: Item) => Partial<Item>)) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...(typeof update === "function" ? update(item) : update) } : item));
  };

  // User actions are saved in order; a failed save only shows after a reload.
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const save = (itemId: string, update: SectionReviewItemUpdate) => {
    if (phase.kind !== "ready" || itemId.startsWith("local-")) return;
    const reviewId = phase.reviewId;
    saving.current = saving.current
      .then(() => api.updateResumeSectionReviewItem(resumeId, reviewId, itemId, update))
      .catch(() => undefined);
  };
  useEffect(() => {
    // Undone from the recap card or edited by hand since the last visit: no longer applied.
    restored?.items.forEach((item) => {
      if (item.status !== "done" && cached?.items.some((old) => old.id === item.id && old.status === "done")) {
        save(item.id, { status: item.draft ? "pending" : "todo", edit: null });
      }
    });
    // Once, for the saved state this sheet opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rewrite = async (item: Item, payload: { lineId: string | null; instruction?: string; answers?: Array<{ question: string; answer: string }> }) => {
    if (!unit) return;
    if (payload.lineId && !editable.has(payload.lineId)) {
      patch(item.id, { status: "error", message: t("这一句太长或不在前 20 条里，AI 不会改它。") });
      return;
    }
    if (phase.kind !== "ready") return;
    const reviewId = phase.reviewId;
    itemRequests.current.get(item.id)?.abort();
    const controller = track();
    itemRequests.current.set(item.id, controller);
    const isLatest = () => itemRequests.current.get(item.id) === controller;
    const section = sectionPayload(unit);
    const baseText = payload.lineId ? section.lines.find((line) => line.id === payload.lineId)?.text ?? "" : "";
    patch(item.id, { status: "loading", message: null });
    try {
      const response = await api.rewriteResumeSectionLine(resumeId, {
        section,
        context: contextPayload(units, contextIds),
        reference: style,
        job_id: job?.id ?? null,
        line_id: payload.lineId,
        instruction: payload.instruction ?? null,
        answers: payload.answers ?? [],
        review_id: reviewId,
        // An item made here (a request, a draft) gets its saved id with the first result.
        ...(item.id.startsWith("local-") ? { item_kind: item.fromDraft ? "draft" as const : "ask" as const } : { item_id: item.id }),
      }, controller.signal);
      if (!isLatest()) return;
      const saved = response.item ? itemFromServer(response.item, item.number) : null;
      patch(item.id, {
        id: saved?.id ?? item.id,
        status: "pending",
        selected: 0,
        ...(saved ? { qIndex: saved.qIndex, answers: saved.answers } : {}),
        draft: saved?.draft ?? { variants: response.variants, missing: response.missing, baseText, lineId: payload.lineId ?? "" },
      });
      if (saved && saved.id !== item.id) setActiveId((current) => (current === item.id ? saved.id : current));
    } catch (error) {
      if (isAbort(error) || !isLatest()) return;
      patch(item.id, { status: "error", message: errorMessage(error) });
    } finally {
      if (isLatest()) itemRequests.current.delete(item.id);
      release(controller);
    }
  };

  const apply = (item: Item) => {
    const draft = item.draft;
    const variant = draft?.variants[item.selected];
    if (!draft || !variant || !draft.lineId) return;
    const before = currentLineText(editor.state.doc, draft.lineId);
    const result = before === null ? "missing" : replaceLineText(editor.state, draft.lineId, draft.baseText, variant.text);
    if (typeof result === "string") {
      patch(item.id, {
        status: "stale",
        message: result === "missing"
          ? t("这一句已经不在简历里了。")
          : t("这一句在分析之后又被改过，为了不覆盖你的修改，这条没有写入。可以重新分析。"),
      });
      return;
    }
    editor.view.dispatch(result);
    // A late reply from「再调语气」must not turn this applied item back to pending.
    itemRequests.current.get(item.id)?.abort();
    itemRequests.current.delete(item.id);
    patch(item.id, { status: "done", message: null, edit: { lineId: draft.lineId, before: before ?? "", after: variant.text } });
    save(item.id, { status: "done", edit: { line_id: draft.lineId, before: before ?? "", after: variant.text } });
    const next = itemsRef.current.find((candidate) => candidate.id !== item.id && (candidate.status === "todo" || candidate.status === "pending"));
    if (next) setActiveId(next.id);
  };

  const undo = (item: Item) => {
    if (!item.edit) return;
    const result = replaceLineText(editor.state, item.edit.lineId, item.edit.after, item.edit.before);
    if (typeof result === "string") {
      patch(item.id, { message: t("这一句之后又被改过，不能自动撤销。") });
      return;
    }
    editor.view.dispatch(result);
    patch(item.id, { status: item.draft ? "pending" : "todo", edit: null, message: null });
    save(item.id, { status: item.draft ? "pending" : "todo", edit: null });
  };

  const skip = (item: Item) => {
    patch(item.id, { status: "skipped", message: null });
    save(item.id, { status: "skipped" });
    const next = itemsRef.current.find((candidate) => candidate.id !== item.id && candidate.status === "todo");
    if (next) setActiveId(next.id);
  };

  const answer = (item: Item, question: SectionReviewQuestion, value: string) => {
    const text = value.trim();
    if (!text || !item.note) return;
    const answers = [...item.answers];
    answers[item.qIndex] = text;
    const questions = item.note.questions;
    const nextIndex = item.qIndex + 1;
    const qIndex = Math.min(nextIndex, questions.length - 1);
    patch(item.id, { answers, qIndex, status: nextIndex < questions.length ? "asking" : item.status });
    // No status here: the rewrite below sets it, and this save may land after it.
    save(item.id, { answers: Array.from(answers, (reply) => reply ?? ""), question_index: qIndex });
    void rewrite({ ...item, answers }, {
      lineId: item.lineId,
      answers: answers.flatMap((reply, position) => reply ? [{ question: questions[position]?.prompt ?? question.prompt, answer: reply }] : []),
    });
  };

  // The user's answers as request pairs, from follow-up questions or the thin-draft form.
  const answerPairs = (item: Item) => {
    const questions = item.note?.questions ?? (phase.kind === "ready" ? phase.result.draft_questions : []);
    return item.answers.flatMap((reply, position) => {
      const text = reply.trim();
      return text && questions[position] ? [{ question: questions[position].prompt, answer: text }] : [];
    });
  };

  // 「再调语气」works on the version on screen, not the original line: keep its content
  // and the user's answers, and only change the tone.
  const retune = (item: Item) => {
    const shown = item.draft?.variants[item.selected]?.text ?? "";
    const instruction = t("在这一版的基础上换一种语气，内容和事实不变：{text}", { text: shown });
    void rewrite(item, {
      lineId: item.lineId,
      instruction: shown && instruction.length <= 300 ? instruction : item.instruction || t("换一种语气，事实不变"),
      answers: answerPairs(item),
    });
  };

  // Hand a line to the ask bar, so the user can say in their own words what to change.
  const askAbout = (lineId: string | null, text = "") => {
    setAskLineId(lineId && editable.has(lineId) ? lineId : null);
    setAskText(text);
    askInput.current?.focus();
  };

  const reviseAsk = (item: Item) => {
    setRevisingId(item.id);
    askAbout(item.lineId, item.instruction);
  };

  const submitAsk = () => {
    const instruction = askText.trim();
    if (!instruction || !unit || phase.kind !== "ready") return;
    const revised = items.find((item) => item.id === revisingId && item.status !== "done");
    setRevisingId(null);
    if (revised) skip(revised);
    const indexFromText = lineIndexFromText(instruction);
    const usable = (id: string | null | undefined) => (id && editable.has(id) ? id : null);
    const activeLine = items.find((item) => item.id === activeId)?.lineId ?? null;
    const lineId = usable(askLineId)
      ?? (indexFromText !== null ? usable(unit.lines[indexFromText]?.id) : null)
      ?? usable(activeLine)
      ?? unit.lines.find((line) => editable.has(line.id))?.id
      ?? null;
    if (!lineId) return;
    const item: Item = {
      id: `local-ask-${Date.now()}`,
      number: null,
      kind: "ask",
      note: null,
      instruction,
      lineId,
      status: "loading",
      qIndex: 0,
      answers: [],
      draft: null,
      selected: 0,
      message: null,
      edit: null,
    };
    setItems((current) => [...current, item]);
    setActiveId(item.id);
    setAskText("");
    setAskLineId(null);
    void rewrite(item, { lineId, instruction });
  };

  const loadJobs = () => {
    if (jobs !== null) return;
    setJobs([]);
    setJobsLoading(true);
    api.listJobDescriptions({ limit: 20 })
      .then((response) => setJobs(response.items))
      .catch(() => setJobs([]))
      .finally(() => setJobsLoading(false));
  };

  if (!unit) return null;

  const ready = phase.kind === "ready" ? phase : null;
  const baseLines = ready?.baseLines ?? Object.fromEntries(unit.lines.map((line) => [line.id, line.text]));
  const lineNotes = (lineId: string | null) => items.filter((item) => (item.note ? item.note.line_id === lineId : item.lineId === lineId && lineId !== null));
  const activeItem = items.find((item) => item.id === activeId) ?? null;
  const contextUnits = units.filter((item) => item.id !== unit.id);
  const firstContext = contextIds.map((id) => units.find((item) => item.id === id)).find(Boolean);
  const contextLabel = !firstContext
    ? t("不参考其他段落")
    : contextIds.length > 1
      ? t("{first} 等 {n} 段", { first: firstContext.heading || firstContext.sectionLabel, n: contextIds.length })
      : unitLabel(firstContext);
  const doneCount = items.filter((item) => item.status === "done").length;
  const askLine = askLineId ? unit.lines.findIndex((line) => line.id === askLineId) : -1;
  const stale = ready ? changedSinceAnalysis(unit, ready.baseLines, items) : false;
  const header = headerParts(unit);
  // Other experiences of the same section, e.g. two internships, numbered so they stay apart.
  const siblings = unit.kind === "entry" && unit.sectionLabel
    ? units.filter((item) => item.kind === "entry" && item.sectionLabel === unit.sectionLabel && sameSection(units, item, unit))
    : [unit];
  const siblingIndex = Math.max(0, siblings.findIndex((item) => item.id === unit.id));

  const renderItemPanel = (item: Item) => {
    const draft = item.draft;
    const note = item.note;
    const question = note?.questions[item.qIndex];
    const open = draft !== null && (item.status === "pending" || item.status === "todo");
    // Each kind offers the next step that fits it: missing facts → revisit the answers,
    // a user request → reword it, wording → another tone or the user's own words.
    const asked = note?.kind === "missing" && note.questions.length > 0;
    const canRetune = open && item.lineId !== null && (item.kind === "wording" || (item.kind === "missing" && !asked));
    return (
      <div className={`sf-panel sf-panel-${item.kind}`}>
        {note?.kind === "missing" && question && item.status !== "done" && (
          <QuestionStep
            key={`${item.id}-${item.qIndex}`}
            question={question}
            index={item.qIndex}
            total={note.questions.length}
            initial={item.answers[item.qIndex] ?? ""}
            onSubmit={(value) => answer(item, question, value)}
          />
        )}
        {note?.kind === "structure" && note.proposal && (
          <div className="sf-linked">
            <span className="sf-mono sf-violet">LINKED</span>
            <span>{unitLabel(units.find((candidate) => candidate.id === note.proposal?.context_id) ?? unit)}</span>
            <p>{note.proposal.summary}</p>
          </div>
        )}
        {item.status === "loading" && <p className="sf-muted">{t("句子正在成形…")}</p>}
        {draft && item.status !== "loading" && (
          <div className="sf-variants">
            {draft.variants.map((variant, position) => (
              <button
                key={variant.id}
                type="button"
                className={`sf-variant${position === item.selected ? " is-selected" : ""}`}
                onClick={() => {
                  patch(item.id, { selected: position });
                  if (position !== item.selected) save(item.id, { selected_index: position });
                }}
                disabled={item.status === "done"}
              >
                <span className="sf-variant-head">
                  <i aria-hidden="true" />
                  {draft.variants.length > 1 && <span className="sf-mono">{"AB"[position]}</span>}
                  <span className="sf-tag">{variant.label}</span>
                </span>
                {draft.baseText && <span className="sf-variant-old"><del className="sf-del">{draft.baseText}</del></span>}
                <span className="sf-variant-text">
                  <DiffText before={draft.baseText} after={variant.text} risky={variant.risky_terms} />
                  {draft.missing.map((label) => <span key={label} className="sf-gap">{t("{label} · 待补充", { label })}</span>)}
                </span>
                {variant.risky_terms.length > 0 && (
                  <span className="sf-risky">
                    {t("「{terms}」比原文说得更重，请确认属实；不确定就选更稳妥的版本。", { terms: variant.risky_terms.join("」「") })}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {item.message && <p className="sf-warn" role="status">{item.message}</p>}
        <div className="sf-panel-actions">
          {item.status === "done" ? (
            <>
              <span className="sf-done">{t("✓ 已采用")}</span>
              <button type="button" className="sf-link" onClick={() => undo(item)}>{t("撤销")}</button>
            </>
          ) : (
            <>
              {draft && (item.status === "pending" || item.status === "todo") && (
                <button type="button" className="sf-btn sf-btn-dark" onClick={() => apply(item)}>
                  {note?.kind === "structure" ? t("应用提案") : draft.variants.length > 1 ? t("用 {v} 版替换", { v: "AB"[item.selected] }) : t("采用")}
                </button>
              )}
              {item.status === "stale" && <button type="button" className="sf-btn" onClick={() => void analyze()}>{t("重新分析")}</button>}
              {item.status === "error" && (item.kind === "ask" || answerPairs(item).length > 0) && (
                <button
                  type="button"
                  className="sf-btn"
                  onClick={() => void rewrite(item, { lineId: item.lineId, instruction: item.kind === "ask" ? item.instruction : undefined, answers: answerPairs(item) })}
                >
                  {t("重试")}
                </button>
              )}
              {asked && item.qIndex > 0 && item.status !== "loading" && (
                <button type="button" className="sf-btn" title={t("回到第 1 题修改补充的信息")} onClick={() => patch(item.id, { qIndex: 0 })}>
                  {t("改回答")}
                </button>
              )}
              {item.kind === "ask" && item.status !== "loading" && (
                <button type="button" className="sf-btn" title={t("把这条要求放回下方输入栏修改后重新生成")} onClick={() => reviseAsk(item)}>
                  {t("改要求")}
                </button>
              )}
              {canRetune && (
                <button type="button" className="sf-btn" title={t("基于当前这版换一种语气，内容不变")} onClick={() => retune(item)}>
                  {t("再调语气")}
                </button>
              )}
              {open && item.kind === "wording" && item.lineId && (
                <button type="button" className="sf-btn" title={t("在下方输入栏写下你对这一句的要求")} onClick={() => askAbout(item.lineId)}>
                  {t("说说要求")}
                </button>
              )}
              {item.status !== "skipped" && (
                <button type="button" className="sf-btn" onClick={() => skip(item)}>{note?.kind === "structure" ? t("不用") : t("跳过这条")}</button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const renderNote = (item: Item) => (
    <button
      key={item.id}
      type="button"
      className={`sf-note sf-note-${item.kind}${item.id === activeId ? " is-active" : ""} is-${item.status}`}
      onClick={() => setActiveId(item.id)}
    >
      <span className="sf-note-head">
        <span className="sf-num">{item.number ?? t("你")}</span>
        <span className="sf-mono">{KIND_LABEL[item.kind]}</span>
        {item.status !== "todo" && <span className="sf-note-status">{t(STATUS_LABEL[item.status])}</span>}
      </span>
      <strong>{item.note?.title ?? item.instruction}</strong>
      {item.note?.detail && item.id === activeId && <small>{item.note.detail}</small>}
    </button>
  );

  const renderLine = (lineId: string, text: string, position: number) => {
    const notes = lineNotes(lineId);
    const appliedEdits = items.flatMap((item) => (item.status === "done" && item.edit?.lineId === lineId ? [item.edit] : []));
    const applied = appliedEdits.length > 0;
    // The first edit in the chain holds the text before this focus session.
    const firstEdit = appliedEdits.find((edit) => !appliedEdits.some((other) => other !== edit && other.after === edit.before));
    const original = firstEdit?.before ?? baseLines[lineId] ?? text;
    const panelItem = activeItem && activeItem.lineId === lineId && activeItem.status !== "todo" ? activeItem : null;
    const showPanel = panelItem ?? (activeItem && activeItem.lineId === lineId && activeItem.kind !== "missing" ? activeItem : null);
    const askingItem = activeItem && activeItem.lineId === lineId && activeItem.kind === "missing" ? activeItem : null;
    return (
      <div key={lineId} className={`sf-row${notes.length ? " has-notes" : ""}${position === readingLine ? " is-reading" : ""}`} style={{ "--sf-row": position } as CSSProperties}>
        <div className="sf-line">
          <span className="sf-bullet" aria-hidden="true">·</span>
          <div className="sf-line-body">
            {applied && original !== text && <del className="sf-del sf-line-old">{original}</del>}
            <p className={`sf-line-text${notes.some((item) => item.id === activeId) ? " is-focused" : ""}`}>
              {applied ? <DiffText before={original} after={text} /> : (
                <QuotedText text={text} quotes={notes.flatMap((item) => item.note && item.status !== "skipped" ? [{ quote: item.note.quote, kind: item.note.kind }] : [])} />
              )}
            </p>
            {!editable.has(lineId) && <small className="sf-muted">{t("这一句太长或不在前 20 条里，AI 不会改它。")}</small>}
            {(askingItem ?? showPanel) && renderItemPanel((askingItem ?? showPanel) as Item)}
          </div>
          {notes.length > 0 && <i className="sf-leader" aria-hidden="true" />}
        </div>
        <div className="sf-notes" aria-label={t("第 {n} 条的批注", { n: position + 1 })}>
          {notes.map(renderNote)}
          {phase.kind === "loading" && editable.has(lineId) && position < 3 && (
            <span className="sf-note-skeleton" aria-hidden="true"><i /><i /></span>
          )}
        </div>
      </div>
    );
  };

  // Analysis in progress, written in the margin where its notes will land.
  const renderThinking = () => {
    // One request does all of it; the phrases only pace the wait.
    const phrases = [
      t("通读这一段"),
      t("对照其他 {n} 段经历", { n: contextIds.length }),
      t("对照{reference}", { reference: job ? `${styleLabel(style)} · ${job.label}` : styleLabel(style) }),
      t("整理批注"),
    ];
    const step = waited < 2 ? 0 : waited < 4 ? 1 : waited < 9 ? 2 : 3;
    return (
      <div className="sf-think" role="status" aria-live="polite">
        <span className="sf-think-label">
          <span className="sf-think-pulse" aria-hidden="true"><i /><i /><i /></span>
          {t("AI 正在分析")}
        </span>
        <strong key={step} className="sf-think-phrase">{phrases[step]}</strong>
        <span className="sf-think-meta">
          <span className="sf-mono">{t("{n} 秒", { n: waited })}</span>
          {waited < 25 ? t("通常 10–30 秒，完成后批注会出现在这一栏") : t("比平时久一些，请再等等")}
        </span>
      </div>
    );
  };

  const handledCount = items.filter((item) => item.status === "done" || item.status === "skipped").length;

  return (
    <div className="sf-stage" role="dialog" aria-modal="true" aria-label={t("段落聚焦")}>
      <nav className="sf-rail" aria-label={t("全文")}>
        <span className="sf-mono sf-muted">{t("全文 · {n} 段", { n: units.length })}</span>
        <ul>
          {railGroups(units).map((group) => (
            <li key={group.units[0].id}>
              {group.label && <span className="sf-rail-section">{group.label}</span>}
              <ul className={group.label ? "sf-rail-entries" : undefined}>
                {group.units.map((item, position) => {
                  const numbered = group.label !== null && group.units.length > 1;
                  const dates = numbered ? headerParts(item).dates[0] : undefined;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`${item.id === unit.id ? "is-current" : ""}${numbered ? " is-numbered" : ""}`}
                        title={unitLabel(item)}
                        onClick={() => item.id !== unit.id && onNavigate(item.id, edits)}
                      >
                        {numbered ? (
                          <>
                            <span className="sf-rail-no">{String(position + 1).padStart(2, "0")}</span>
                            <span className="sf-rail-name">
                              <span className="sf-rail-title">{item.heading || item.sectionLabel}</span>
                              {dates && <small>{dates}</small>}
                            </span>
                          </>
                        ) : <span className="sf-rail-title">{item.heading || item.sectionLabel}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </nav>

      <section className="sf-sheet">
        <header className={`sf-sheet-head${phase.kind === "loading" ? " is-thinking" : ""}`}>
          <div className="sf-title-row">
            <span className="sf-mono">FOCUS</span>
            <span className="sf-muted sf-position">
              {siblings.length > 1
                ? t("{section} · 第 {n} 段，共 {total} 段", { section: unit.sectionLabel, n: siblingIndex + 1, total: siblings.length })
                : `${unit.sectionLabel} · ${String(index + 1).padStart(2, "0")} / ${String(units.length).padStart(2, "0")}`}
            </span>
            <span className="sf-head-actions">
              <button type="button" className="sf-regen" disabled={phase.kind === "loading"} onClick={() => void analyze()}>
                <RefreshCw size={13} aria-hidden="true" />
                {t("重新生成")}
              </button>
              <button type="button" className="sf-close" onClick={close} aria-label={t("完成并放回")}>{t("完成")}</button>
            </span>
          </div>
          <div className="sf-setup">
            <span className="sf-sentence">
              {t("以")}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="sf-pick" aria-label={t("分析风格")}>
                    <span>{styleLabel(style)}</span>
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="sf-menu sf-menu-wide">
                  <div className="sf-menu-label">{t("分析风格")}</div>
                  {STYLES.map((item) => (
                    <DropdownMenuItem key={item.label} onSelect={() => setStyle(item.style)}>
                      <span className="sf-menu-method">
                        {t(item.label)}
                        <small>{t(item.hint)}</small>
                      </span>
                      {sameStyle(item.style, style) && <Check aria-hidden="true" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {t("分析，投递")}
              <DropdownMenu onOpenChange={(open) => open && loadJobs()}>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={`sf-pick${job ? "" : " sf-pick-quiet"}`} aria-label={t("投递岗位")}>
                    <span>{job?.label ?? t("不指定岗位")}</span>
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="sf-menu sf-menu-wide">
                  <div className="sf-menu-label">{t("选填，选了就按岗位要求分析")}</div>
                  <DropdownMenuItem onSelect={() => setJob(null)}>
                    <span>{t("不指定岗位")}</span>
                    {!job && <Check aria-hidden="true" />}
                  </DropdownMenuItem>
                  {job && !jobs?.some((item) => item.id === job.id) && (
                    <DropdownMenuItem onSelect={() => undefined}>
                      <span>{job.label}</span>
                      <Check aria-hidden="true" />
                    </DropdownMenuItem>
                  )}
                  <div className="sf-menu-label">{t("已收集的岗位")}</div>
                  {jobsLoading && <div className="sf-menu-empty">{t("正在读取岗位…")}</div>}
                  {!jobsLoading && jobs?.length === 0 && <div className="sf-menu-empty">{t("还没有收集岗位")}</div>}
                  {jobs?.map((item) => (
                    <DropdownMenuItem key={item.id} onSelect={() => setJob({ id: item.id, label: `${item.company_name} · ${item.job_title}` })}>
                      <span>{item.company_name} · {item.job_title}</span>
                      {job?.id === item.id && <Check aria-hidden="true" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="sf-tight">{t("，突出")}</span>
              <input
                className="sf-intent"
                aria-label={t("想突出的方向")}
                value={intent}
                title={intent || ready?.result.inferred_focus || undefined}
                placeholder={ready?.result.inferred_focus ?? t("想突出什么")}
                onChange={(event) => setIntent(event.target.value)}
                maxLength={300}
              />
              {ready?.result.inferred_focus && !intent.trim() && (
                <button type="button" className="sf-link sf-infer-use" title={t("AI 推断这段想突出「{focus}」", { focus: ready.result.inferred_focus })} onClick={() => setIntent(ready.result.inferred_focus ?? "")}>
                  {t("就按 AI 推断")}
                </button>
              )}
            </span>
            <span className="sf-context">
              {t("一并参考")}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="sf-pick sf-pick-quiet" aria-label={t("参考段落")}>
                    <span>{contextLabel}</span>
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="sf-menu sf-menu-wide">
                  <div className="sf-menu-label">{t("最多 {n} 段，分析时一并参考", { n: CONTEXT_LIMIT })}</div>
                  {contextUnits.map((item) => {
                    const checked = contextIds.includes(item.id);
                    const full = !checked && contextIds.length >= CONTEXT_LIMIT;
                    return (
                      <DropdownMenuItem
                        key={item.id}
                        disabled={full}
                        className={checked ? "is-checked" : undefined}
                        onSelect={(event) => {
                          // Keep the menu open so several sections can be picked in a row.
                          event.preventDefault();
                          setContextIds((current) => current.includes(item.id) ? current.filter((value) => value !== item.id) : [...current, item.id]);
                        }}
                      >
                        <i className="sf-menu-box" aria-hidden="true">{checked && <Check />}</i>
                        <span>{unitLabel(item)}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>
          {ready && stale && (
            <p className="sf-reuse">
              {t("这段在上次分析后改过，建议点「重新生成」。")}
            </p>
          )}
        </header>

        <div className={`sf-body${phase.kind === "loading" ? " is-thinking" : ""}`}>
          {phase.kind === "error" && (
            <div className="sf-empty" role="alert">
              <p>{phase.message}</p>
              <button type="button" className="sf-btn" onClick={() => void analyze()}>{t("重试")}</button>
            </div>
          )}

          <div className="sf-row sf-row-head">
            <div className="sf-line">
              <div className="sf-line-body">
                <div className={`sf-entry-head${siblings.length > 1 ? " is-numbered" : ""}`}>
                  {siblings.length > 1 && <span className="sf-entry-no">{String(siblingIndex + 1).padStart(2, "0")}</span>}
                  <h2 className="sf-heading">{unit.heading}</h2>
                  {header.dates.length > 0 && <span className="sf-dates">{header.dates.join(" · ")}</span>}
                </div>
                {header.details.length > 0 && <p className="sf-meta">{header.details.join("  ·  ")}</p>}
                {siblings.length > 1 && (
                  <p className="sf-siblings">
                    <span className="sf-muted">{t("同一分区的其他经历")}</span>
                    {siblings.filter((item) => item.id !== unit.id).map((item) => (
                      <button key={item.id} type="button" onClick={() => onNavigate(item.id, edits)}>
                        <b>{String(siblings.indexOf(item) + 1).padStart(2, "0")}</b>
                        {item.heading}
                        {headerParts(item).dates[0] && <small>{headerParts(item).dates[0]}</small>}
                        <span aria-hidden="true">→</span>
                      </button>
                    ))}
                  </p>
                )}
                {activeItem && activeItem.lineId === null && renderItemPanel(activeItem)}
              </div>
              {lineNotes(null).length > 0 && <i className="sf-leader" aria-hidden="true" />}
            </div>
            <div className="sf-notes">
              {lineNotes(null).map(renderNote)}
              {phase.kind === "loading" && renderThinking()}
            </div>
          </div>

          {ready?.result.too_thin ? (
            <ThinDraft
              questions={ready.result.draft_questions}
              answers={draftAnswers}
              hasLine={unit.lines.length > 0}
              onAnswer={(values) => {
                setDraftAnswers(values);
                const lineId = unit.lines.find((line) => editable.has(line.id))?.id ?? null;
                if (!lineId) return;
                const item: Item = {
                  id: `local-draft-${Date.now()}`,
                  number: 1,
                  kind: "missing",
                  note: null,
                  instruction: t("按你的回答起草"),
                  fromDraft: true,
                  lineId,
                  status: "loading",
                  qIndex: 0,
                  answers: values,
                  draft: null,
                  selected: 0,
                  message: null,
                  edit: null,
                };
                // Replace an unapplied draft; an applied one stays listed and undoable.
                setItems((current) => [...current.filter((candidate) => !(candidate.fromDraft && candidate.status !== "done")), item]);
                setActiveId(item.id);
                void rewrite(item, {
                  lineId,
                  answers: values.flatMap((value, position) => value.trim() ? [{ question: ready.result.draft_questions[position]?.prompt ?? "", answer: value.trim() }] : []),
                });
              }}
            />
          ) : null}

          {unit.lines.map((line, position) => renderLine(line.id, line.text, position))}

          {ready && !ready.result.too_thin && ready.result.notes.length === 0 && (
            <p className="sf-empty-note">{t("这段没有发现需要处理的问题。也可以在下面直接说出你的要求。")}</p>
          )}
        </div>

        <form
          className="sf-ask"
          onSubmit={(event) => {
            event.preventDefault();
            submitAsk();
          }}
        >
          <i className="sf-ring" aria-hidden="true" />
          <input
            ref={askInput}
            value={askText}
            onChange={(event) => {
              setAskText(event.target.value);
              if (!event.target.value.trim()) setRevisingId(null);
            }}
            placeholder={phase.kind === "loading" ? t("AI 分析完成后，可以在这里继续提要求") : t("还有想法？直接告诉 AI，比如「第 2 条写得更有冲击力，但别夸大」")}
            maxLength={300}
            disabled={phase.kind !== "ready" || !unit.lines.length}
            aria-label={t("补充要求")}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={phase.kind !== "ready"}>
              <button type="button" className="sf-pick sf-pick-chip" aria-label={t("作用于哪一条")}>
                <span>{askLine >= 0 ? t("第 {n} 条", { n: askLine + 1 }) : t("自动判断")}</span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="sf-menu">
              <DropdownMenuItem onSelect={() => setAskLineId(null)}>
                <span>{t("自动判断")}</span>
                {askLine < 0 && <Check aria-hidden="true" />}
              </DropdownMenuItem>
              {unit.lines.map((line, position) => editable.has(line.id) && (
                <DropdownMenuItem key={line.id} onSelect={() => setAskLineId(line.id)}>
                  <span>{t("第 {n} 条", { n: position + 1 })}</span>
                  <small>{line.text.slice(0, 16)}</small>
                  {askLineId === line.id && <Check aria-hidden="true" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="submit" className="sf-enter" disabled={!askText.trim() || phase.kind !== "ready"} aria-label={t("发送")}>↵</button>
          <span className="sf-muted">{t("只作用于这一段")}</span>
        </form>

        <footer className="sf-foot">
          <div className="sf-ledger" aria-label={t("本段改动")}>
            <strong>{phase.kind === "ready" && doneCount === 0 ? t("原文未改动") : t("本段改动")}</strong>
            {items.length > 0 && <span className="sf-ledger-count">{t("已处理 {done} / {n}", { done: handledCount, n: items.length })}</span>}
          </div>
          <span className="sf-keys">
            <kbd>↑↓</kbd>{t("切换建议")}
            <kbd>Esc</kbd>{t("完成并放回")}
          </span>
        </footer>
      </section>
    </div>
  );
}

/**
 * Rail entries grouped by section: entries sit under their section name, while
 * a section that is itself the unit (e.g. skills) stands alone.
 */
/** Whether two entries sit in the same run of a section (sections can repeat a label). */
function sameSection(units: FocusUnit[], a: FocusUnit, b: FocusUnit) {
  const group = railGroups(units).find((candidate) => candidate.units.includes(b));
  return group?.units.includes(a) ?? false;
}

function railGroups(units: FocusUnit[]) {
  const groups: Array<{ label: string | null; units: FocusUnit[] }> = [];
  for (const unit of units) {
    const last = groups[groups.length - 1];
    if (unit.kind === "entry" && unit.sectionLabel && last?.label === unit.sectionLabel) {
      last.units.push(unit);
    } else {
      groups.push({ label: unit.kind === "entry" && unit.sectionLabel ? unit.sectionLabel : null, units: [unit] });
    }
  }
  return groups;
}

function QuestionStep({
  question,
  index,
  total,
  initial,
  onSubmit,
}: {
  question: SectionReviewQuestion;
  index: number;
  total: number;
  initial: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="sf-question"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <span className="sf-mono sf-orange">ASK · Q{index + 1} / {total}</span>
      <p className="sf-question-text">{question.prompt}</p>
      {question.options.length > 0 && (
        <div className="sf-options">
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              className={`sf-option${value === option ? " is-selected" : ""}`}
              onClick={() => setValue(option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      <label className="sf-answer">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // Enter submits right away; Enter that confirms an IME candidate does not.
            if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            if (value.trim()) onSubmit(value);
          }}
          maxLength={300}
          placeholder={t("用你自己的话回答，AI 不会替你编")}
          autoFocus
        />
        <button type="submit" disabled={!value.trim()}>{index + 1 < total ? t("下一题 ↵") : t("生成 ↵")}</button>
      </label>
    </form>
  );
}

function ThinDraft({
  questions,
  answers,
  hasLine,
  onAnswer,
}: {
  questions: SectionReviewQuestion[];
  answers: string[];
  hasLine: boolean;
  onAnswer: (values: string[]) => void;
}) {
  const [values, setValues] = useState<string[]>(() => questions.map((_, index) => answers[index] ?? ""));
  if (!hasLine) {
    return <p className="sf-empty-note">{t("这段还是空的。先在页面上写一句你做了什么，再来聚焦。")}</p>;
  }
  return (
    <form
      className="sf-thin"
      onSubmit={(event) => {
        event.preventDefault();
        onAnswer(values);
      }}
    >
      <span className="sf-mono sf-orange">{t("内容太少 · 先回答几个问题来起草")}</span>
      {questions.map((question, index) => (
        <label key={question.id}>
          <span>{question.prompt}</span>
          <input
            value={values[index] ?? ""}
            maxLength={300}
            onChange={(event) => setValues((current) => current.map((item, position) => position === index ? event.target.value : item))}
          />
        </label>
      ))}
      <button type="submit" className="sf-btn sf-btn-dark" disabled={!values.some((item) => item.trim())}>{t("起草")}</button>
    </form>
  );
}
