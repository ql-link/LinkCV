import { t } from "@/i18n";
import type { Editor } from "@tiptap/core";
import { RefreshCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  api,
  ApiRequestError,
  type JobDescriptionSummary,
  type SectionReviewAnalyzeResponse,
  type SectionReviewNote,
  type SectionReviewNoteKind,
  type SectionReviewQuestion,
  type SectionReviewReference,
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

export type AppliedEdit = LineEdit & {
  id: string;
  unitId: string;
  kind: SectionReviewNoteKind | "ask";
  title: string;
};

/** `itemId` opens the sheet on one saved suggestion, e.g. from the page annotations. */
export type FocusRequest = { unitId: string; intent: string; itemId?: string };

type Reference = SectionReviewReference & { label?: string };
type Draft = { variants: SectionReviewVariant[]; missing: string[]; baseText: string; lineId: string };
type ItemStatus = "todo" | "asking" | "loading" | "pending" | "done" | "skipped" | "stale" | "error";
type Item = {
  id: string;
  number: number | null;
  kind: SectionReviewNoteKind | "ask";
  note: SectionReviewNote | null;
  instruction: string;
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
  | { kind: "ready"; result: SectionReviewAnalyzeResponse; baseLines: Record<string, string> };

/** A finished analysis kept for the session, so reopening a paragraph does not call the model again. */
export type SheetSnapshot = {
  phase: Extract<Phase, { kind: "ready" }>;
  items: Item[];
  activeId: string | null;
  reference: Reference;
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
  const [restored] = useState(() => (cached ? { ...cached, items: restoreItems(cached.items, editor) } : null));
  // A new instruction from ⌘K asks for a fresh analysis even when one is saved.
  const [autoRun] = useState(() => !restored || Boolean(request.intent.trim()));
  const [reference, setReference] = useState<Reference>(restored?.reference ?? { kind: "general" });
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
  const [jobs, setJobs] = useState<JobDescriptionSummary[] | null>(null);
  const [draftAnswers, setDraftAnswers] = useState<string[]>(restored?.draftAnswers ?? []);
  const controllers = useRef(new Set<AbortController>());
  // Latest rewrite per item; an older reply must not overwrite a newer one.
  const itemRequests = useRef(new Map<string, AbortController>());
  const editable = useMemo(() => (unit ? editableLineIds(unit) : new Set<string>()), [unit]);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const runIdRef = useRef(restored?.runId ?? 0);
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
        reference: reference.kind === "job" ? { kind: "job", job_id: reference.job_id } : { kind: "general" },
      }, controller.signal);
      if (runId !== runIdRef.current) return;
      const baseLines = Object.fromEntries(section.lines.map((line) => [line.id, line.text]));
      const editableIds = editableLineIds(unit);
      const fallbackLine = section.lines.find((line) => editableIds.has(line.id))?.id ?? null;
      // Notes whose target line the AI may not rewrite are dropped up front.
      const notes = result.notes.filter((note) => {
        const target = note.proposal?.line_id ?? note.line_id ?? fallbackLine;
        return target !== null && editableIds.has(target);
      });
      setPhase({ kind: "ready", result: { ...result, notes }, baseLines });
      setItems((current) => {
        // Applied changes survive a re-analysis so they stay listed and undoable.
        const kept = current.filter((item) => item.status === "done");
        const offset = kept.reduce((max, item) => Math.max(max, item.number ?? 0), 0);
        return [
          ...kept,
          ...notes.map((note, position): Item => ({
            id: `r${runId}-${note.id}`,
            number: offset + position + 1,
            kind: note.kind,
            note,
            instruction: "",
            lineId: note.line_id ?? note.proposal?.line_id ?? fallbackLine,
            status: "todo",
            qIndex: 0,
            answers: [],
            draft: note.kind === "wording" && note.line_id
              ? { variants: note.variants, missing: [], baseText: baseLines[note.line_id] ?? "", lineId: note.line_id }
              : note.kind === "structure" && note.proposal
                ? {
                  variants: [{ id: `${note.id}-p`, label: t("提案"), text: note.proposal.text, risky_terms: [] }],
                  missing: [],
                  baseText: baseLines[note.proposal.line_id] ?? "",
                  lineId: note.proposal.line_id,
                }
                : null,
            selected: 0,
            message: null,
            edit: null,
            })),
        ];
      });
      setActiveId(notes[0] ? `r${runId}-${notes[0].id}` : null);
    } catch (error) {
      if (isAbort(error) || runId !== runIdRef.current) return;
      setPhase({ kind: "error", message: errorMessage(error) });
    } finally {
      release(controller);
    }
  }, [unit, units, resumeId, contextIds, intent, reference, track, release]);

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
      ? { phase, items, activeId, reference, intent, contextIds, draftAnswers, runId: runIdRef.current }
      : null;
  }, [phase, items, activeId, reference, intent, contextIds, draftAnswers]);
  useEffect(() => () => {
    if (snapshot.current) onSave(request.unitId, snapshot.current);
    // Saved once, on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
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

  const rewrite = async (item: Item, payload: { lineId: string | null; instruction?: string; answers?: Array<{ question: string; answer: string }> }) => {
    if (!unit) return;
    if (payload.lineId && !editable.has(payload.lineId)) {
      patch(item.id, { status: "error", message: t("这一句太长或不在前 20 条里，AI 不会改它。") });
      return;
    }
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
        reference: reference.kind === "job" ? { kind: "job", job_id: reference.job_id } : { kind: "general" },
        line_id: payload.lineId,
        instruction: payload.instruction ?? null,
        answers: payload.answers ?? [],
      }, controller.signal);
      if (!isLatest()) return;
      patch(item.id, {
        status: "pending",
        selected: 0,
        draft: { variants: response.variants, missing: response.missing, baseText, lineId: payload.lineId ?? "" },
      });
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
  };

  const skip = (item: Item) => {
    patch(item.id, { status: "skipped", message: null });
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
    patch(item.id, { answers, qIndex: Math.min(nextIndex, questions.length - 1), status: nextIndex < questions.length ? "asking" : item.status });
    void rewrite({ ...item, answers }, {
      lineId: item.lineId,
      answers: answers.flatMap((reply, position) => reply ? [{ question: questions[position]?.prompt ?? question.prompt, answer: reply }] : []),
    });
  };

  const submitAsk = () => {
    const instruction = askText.trim();
    if (!instruction || !unit || phase.kind !== "ready") return;
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
      id: `ask-${Date.now()}`,
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
    api.listJobDescriptions({ limit: 20 })
      .then((response) => setJobs(response.items))
      .catch(() => setJobs([]));
  };

  if (!unit) return null;

  const ready = phase.kind === "ready" ? phase : null;
  const baseLines = ready?.baseLines ?? Object.fromEntries(unit.lines.map((line) => [line.id, line.text]));
  const lineNotes = (lineId: string | null) => items.filter((item) => (item.note ? item.note.line_id === lineId : item.lineId === lineId && lineId !== null));
  const activeItem = items.find((item) => item.id === activeId) ?? null;
  const contextUnits = units.filter((item) => item.id !== unit.id);
  const doneCount = items.filter((item) => item.status === "done").length;
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
                onClick={() => patch(item.id, { selected: position })}
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
              {item.status === "error" && item.kind === "ask" && (
                <button type="button" className="sf-btn" onClick={() => void rewrite(item, { lineId: item.lineId, instruction: item.instruction })}>{t("重试")}</button>
              )}
              {draft && (item.status === "pending" || item.status === "todo") && note?.kind !== "structure" && item.lineId && (
                <button type="button" className="sf-btn" onClick={() => void rewrite(item, { lineId: item.lineId, instruction: item.instruction || t("换一种语气，事实不变") })}>
                  {t("再调语气")}
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
      <div key={lineId} className={`sf-row${notes.length ? " has-notes" : ""}`}>
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
        <div className="sf-notes" aria-label={t("第 {n} 条的批注", { n: position + 1 })}>{notes.map(renderNote)}</div>
      </div>
    );
  };

  const statusChip = (item: Item) => (
    <button key={item.id} type="button" className={`sf-chip is-${item.status} sf-chip-${item.kind}`} onClick={() => setActiveId(item.id)}>
      <span className="sf-num">{item.number ?? t("你")}</span>
      <span>{(item.note?.title ?? item.instruction).slice(0, 12)}</span>
      <b>{t(STATUS_LABEL[item.status])}</b>
    </button>
  );

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
                              {item.heading || item.sectionLabel}
                              {dates && <small>{dates}</small>}
                            </span>
                          </>
                        ) : item.heading || item.sectionLabel}
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
        <header className="sf-sheet-head">
          <div className="sf-title-row">
            <span className="sf-mono">FOCUS</span>
            <span className="sf-muted">
              {siblings.length > 1
                ? t("{section} · 第 {n} 段，共 {total} 段", { section: unit.sectionLabel, n: siblingIndex + 1, total: siblings.length })
                : `${unit.sectionLabel} · ${String(index + 1).padStart(2, "0")} / ${String(units.length).padStart(2, "0")}`}
            </span>
            <span className="sf-sentence">
              {t("以")}
              <select
                aria-label={t("参照")}
                value={reference.kind === "job" ? reference.job_id : "general"}
                onFocus={loadJobs}
                onMouseDown={loadJobs}
                onChange={(event) => {
                  const value = event.target.value;
                  const job = jobs?.find((item) => item.id === value);
                  setReference(job ? { kind: "job", job_id: job.id, label: `${job.company_name} · ${job.job_title}` } : { kind: "general" });
                }}
              >
                <option value="general">{t("通用写作标准")}</option>
                {reference.kind === "job" && !jobs?.some((job) => job.id === reference.job_id) && (
                  <option value={reference.job_id}>{reference.label}</option>
                )}
                {jobs?.map((job) => <option key={job.id} value={job.id}>{job.company_name} · {job.job_title}</option>)}
              </select>
              {t("为参照，突出")}
              <input
                aria-label={t("想突出的方向")}
                value={intent}
                placeholder={ready?.result.inferred_focus ?? t("想突出什么")}
                onChange={(event) => setIntent(event.target.value)}
                maxLength={300}
              />
            </span>
            <span className="sf-head-actions">
              <button type="button" className="sf-regen" disabled={phase.kind === "loading"} onClick={() => void analyze()}>
                <RefreshCw size={13} aria-hidden="true" />
                {t("重新生成")}
              </button>
              <button type="button" className="sf-close" onClick={close} aria-label={t("完成并放回")}>{t("完成")}</button>
            </span>
          </div>
          {ready && stale && (
            <p className="sf-reuse">
              {t("这段在上次分析后改过，建议点「重新生成」。")}
            </p>
          )}
          {ready?.result.inferred_focus && !intent.trim() && (
            <p className="sf-infer">
              {t("AI 推断这段想突出「{focus}」", { focus: ready.result.inferred_focus })}
              <button type="button" className="sf-link" onClick={() => setIntent(ready.result.inferred_focus ?? "")}>{t("就按这个")}</button>
            </p>
          )}
          <div className="sf-context">
            <span className="sf-mono sf-muted">CONTEXT</span>
            <span className="sf-muted">{t("一并参考")}</span>
            {contextIds.map((id) => {
              const item = units.find((candidate) => candidate.id === id);
              if (!item) return null;
              return (
                <span key={id} className="sf-context-chip">
                  {unitLabel(item)}
                  <button type="button" aria-label={t("不参考这一段")} onClick={() => setContextIds((current) => current.filter((value) => value !== id))}>×</button>
                </span>
              );
            })}
            {contextIds.length < CONTEXT_LIMIT && contextUnits.some((item) => !contextIds.includes(item.id)) && (
              <select
                className="sf-context-add"
                aria-label={t("添加参考段落")}
                value=""
                onChange={(event) => event.target.value && setContextIds((current) => [...current, event.target.value])}
              >
                <option value="">{t("+ 添加")}</option>
                {contextUnits.filter((item) => !contextIds.includes(item.id)).map((item) => (
                  <option key={item.id} value={item.id}>{unitLabel(item)}</option>
                ))}
              </select>
            )}
          </div>
        </header>

        <div className="sf-body">
          {phase.kind === "loading" && (
            <ol className="sf-steps" aria-live="polite">
              <li className="is-done">{t("读取这一段")}</li>
              <li className="is-done">{t("读取 {n} 处上下文", { n: contextIds.length })}</li>
              <li className="is-current">{t("对照{reference}", { reference: reference.kind === "job" ? reference.label ?? t("目标岗位") : t("通用写作标准") })}</li>
              <li>{t("生成建议")}</li>
            </ol>
          )}
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
            <div className="sf-notes">{lineNotes(null).map(renderNote)}</div>
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
                  id: `draft-${Date.now()}`,
                  number: 1,
                  kind: "missing",
                  note: null,
                  instruction: t("按你的回答起草"),
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
                setItems((current) => [...current.filter((candidate) => !(candidate.id.startsWith("draft-") && candidate.status !== "done")), item]);
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
            value={askText}
            onChange={(event) => setAskText(event.target.value)}
            placeholder={t("还有想法？直接告诉 AI，比如「第 2 条写得更有冲击力，但别夸大」")}
            maxLength={300}
            disabled={phase.kind !== "ready" || !unit.lines.length}
            aria-label={t("补充要求")}
          />
          <select
            aria-label={t("作用于哪一条")}
            value={askLineId ?? ""}
            onChange={(event) => setAskLineId(event.target.value || null)}
            disabled={phase.kind !== "ready"}
          >
            <option value="">{t("自动判断")}</option>
            {unit.lines.map((line, position) => editable.has(line.id) && <option key={line.id} value={line.id}>{t("第 {n} 条", { n: position + 1 })}</option>)}
          </select>
          <button type="submit" className="sf-enter" disabled={!askText.trim() || phase.kind !== "ready"} aria-label={t("发送")}>↵</button>
          <span className="sf-muted">{t("只作用于这一段")}</span>
        </form>

        <footer className="sf-foot">
          <div className="sf-ledger" aria-label={t("本段改动")}>
            <strong>{phase.kind === "ready" && doneCount === 0 ? t("原文未改动") : t("本段改动")}</strong>
            {items.map(statusChip)}
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
        <input value={value} onChange={(event) => setValue(event.target.value)} maxLength={300} placeholder={t("用你自己的话回答，AI 不会替你编")} autoFocus />
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
