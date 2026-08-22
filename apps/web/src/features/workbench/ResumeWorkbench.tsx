import { posToDOMRect, type Editor, type JSONContent } from "@tiptap/core";
import { BubbleMenu, EditorContent, useEditor } from "@tiptap/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  AlertTriangle,
  CircleCheck,
  FileDown,
  History,
  Home,
  LoaderCircle,
  Minus,
  Pencil,
  Plus,
  Save,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ApiRequestError } from "../../api/client";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  Label,
  PageLoading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui";
import { defaultSettings, resumeSerifFontStack, useResumeStore } from "../../store/resumeStore";
import { resumeEditorExtensions } from "./editorExtensions";
import { WorkbenchToolbar } from "./WorkbenchToolbar";
import { createSelectionBubbleAnchor, shouldShowWorkbenchBubbleMenu } from "./selectionBubbleAnchor";
import { getTwoPageFitScale, getWheelZoomScale, handleWheelZoom } from "./workbenchZoom";
import { navigateTo } from "../../routing";
import { BlankLineMenuExtension, SlashCommandMenu, type CommandMenuState } from "./slashCommand";
import { VersionDiffDialog } from "./VersionDiffDialog";
import { PaginationExtension } from "./paginationPlugin";
import {
  capturePageViewportAnchor,
  restorePageViewportAnchor,
  type PageArrangement,
  type PageViewportMetrics,
} from "./pageArrangementTransition";

type DrawerMode = "settings" | "history" | null;
type ToastState = { label: string } | null;
export type { PageArrangement } from "./pageArrangementTransition";

const EMPTY_IMPORT_WARNINGS: string[] = [];
const A4_WIDTH_IN_CSS_PIXELS = (210 / 25.4) * 96;
const PAGE_ARRANGEMENT_STORAGE_KEY = "linkcv.workbench.page-arrangement";

function currentSelectionRect(editor: Editor) {
  const { ranges } = editor.state.selection;
  const from = Math.min(...ranges.map((range) => range.$from.pos));
  const to = Math.max(...ranges.map((range) => range.$to.pos));
  return posToDOMRect(editor.view, from, to);
}

function StableWorkbenchBubbleMenu({ editor, children }: { editor: Editor; children: ReactNode }) {
  const anchorRef = useRef<ReturnType<typeof createSelectionBubbleAnchor> | null>(null);
  if (!anchorRef.current) anchorRef.current = createSelectionBubbleAnchor();
  const anchor = anchorRef.current;

  useEffect(() => {
    const scrollArea = editor.view.dom.closest(".workbench-canvas");
    const refresh = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty) anchor.observe({ from, to }, () => currentSelectionRect(editor));
      else anchor.refresh(() => currentSelectionRect(editor));
    };
    scrollArea?.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh, { passive: true });
    return () => {
      scrollArea?.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [anchor, editor]);

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{
        duration: 150,
        maxWidth: "none",
        placement: "top-start",
        getReferenceClientRect: () => anchor.getRect(() => currentSelectionRect(editor)),
      }}
      shouldShow={({ editor: current, view, from, to }) => {
        const visible = shouldShowWorkbenchBubbleMenu({
          editable: current.isEditable,
          selectionEmpty: current.state.selection.empty,
          resumeRowActive: current.isActive("resumeRow"),
        });
        anchor.observe(visible ? { from, to } : { from, to: from }, () => posToDOMRect(view, from, to));
        return visible;
      }}
    >
      {children}
    </BubbleMenu>
  );
}

function pageViewportMetrics(
  scrollArea: HTMLElement,
  paper: HTMLElement,
  arrangement: PageArrangement,
  scale: number,
): PageViewportMetrics {
  const scrollRect = scrollArea.getBoundingClientRect();
  const paperRect = paper.getBoundingClientRect();
  const configuredCount = Number.parseInt(getComputedStyle(paper).getPropertyValue("--resume-page-count"), 10);
  const pageCount = Number.isFinite(configuredCount)
    ? Math.max(1, configuredCount)
    : paper.querySelectorAll(".workbench-page-break").length + 1;
  return {
    arrangement,
    scale,
    pageCount,
    clientWidth: scrollArea.clientWidth,
    clientHeight: scrollArea.clientHeight,
    scrollLeft: scrollArea.scrollLeft,
    scrollTop: scrollArea.scrollTop,
    scrollWidth: scrollArea.scrollWidth,
    scrollHeight: scrollArea.scrollHeight,
    paperLeft: paperRect.left - scrollRect.left + scrollArea.scrollLeft,
    paperTop: paperRect.top - scrollRect.top + scrollArea.scrollTop,
  };
}

const fontOptions = [
  { label: "简历宋体", value: resumeSerifFontStack },
  { label: "霞鹜文楷", value: '"LXGW WenKai", KaiTi, STKaiti, "Songti SC", serif' },
  { label: "系统黑体", value: '"PingFang SC", "Microsoft YaHei", Inter, system-ui, sans-serif' },
];

const FONT_PREVIEW_TEXT = "张三的简历 Resume";

const versionReasonLabels = {
  initial: "初始版本",
  manual: "手动保存",
  before_restore: "恢复前备份",
  restore: "恢复结果（历史记录）",
} as const;

const MAX_VERSION_NAME_LENGTH = 80;

export function normalizeVersionName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function versionNameValidationMessage(value: string) {
  const normalized = normalizeVersionName(value);
  if (!normalized) return "请填写版本名称";
  if (normalized.length > MAX_VERSION_NAME_LENGTH) return `版本名称不能超过 ${MAX_VERSION_NAME_LENGTH} 个字符`;
  return null;
}

function versionTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function versionOperationErrorMessage(error: unknown, operation: "create" | "restore") {
  if (operation !== "create" || !(error instanceof ApiRequestError) || error.message !== "RESUME_VERSION_LIMIT_REACHED") {
    return null;
  }
  return "当前内容已保存，但版本数量已达上限。请删除一个旧版本后再保存新版本。";
}

export function versionRenameErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.message === "INVALID_RESUME_VERSION_NAME") return "版本名称不能为空且不能超过 80 个字符。";
    if (error.message === "RESUME_VERSION_NOT_FOUND") return "该版本不存在，请刷新后重试。";
  }
  return "保存版本名称失败，请稍后重试。";
}

export function VersionRenameAction({
  name,
  versionNo,
  disabled = false,
  busy = false,
  error = null,
  onStartRename,
  onRename,
}: {
  name: string;
  versionNo: number;
  disabled?: boolean;
  busy?: boolean;
  error?: string | null;
  onStartRename?: () => void;
  onRename: (name: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [editing, name]);

  const startEditing = () => {
    if (disabled || busy) return;
    setDraft(name);
    setValidationError(null);
    setEditing(true);
    onStartRename?.();
  };

  const cancelEditing = () => {
    if (busy) return;
    setDraft(name);
    setValidationError(null);
    setEditing(false);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = draft.trim();
    if (busy) return;
    if (!nextName) {
      setValidationError("请填写版本名称");
      return;
    }
    if (nextName.length > 80) {
      setValidationError("版本名称不能超过 80 个字符");
      return;
    }
    if (nextName === name.trim()) {
      setEditing(false);
      return;
    }
    try {
      await onRename(nextName);
      setEditing(false);
    } catch {
      // Keep the input open so the user can correct and retry after an error.
    }
  };
  const visibleError = error ?? validationError;

  return (
    <div className="version-row-name">
      {editing ? (
        <form className="version-row-name-edit" onSubmit={(event) => void submit(event)}>
          <input
            id={`version-name-input-${versionNo}`}
            className="version-row-name-input"
            autoFocus
            autoComplete="off"
            maxLength={80}
            value={draft}
            disabled={busy}
            aria-invalid={Boolean(visibleError)}
            aria-label={`版本 ${versionNo} 名称`}
            aria-describedby={visibleError ? `version-name-error-${versionNo}` : undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              setValidationError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEditing();
              }
            }}
          />
          {visibleError ? (
            <small className="version-row-name-error" id={`version-name-error-${versionNo}`} role="alert">{visibleError}</small>
          ) : null}
        </form>
      ) : (
        <div className="version-row-name-value">
          <strong title={name}>{name}</strong>
          <IconButton
            className="version-rename-icon"
            label={`重命名版本 ${versionNo}`}
            disabled={disabled || busy}
            onClick={startEditing}
          >
            <Pencil size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

type EditorContentCommands = {
  commands: {
    setContent: (content: string | JSONContent, emitUpdate?: boolean) => unknown;
  };
};

type RestorableEditor = EditorContentCommands & {
  setEditable: (editable: boolean, emitUpdate?: boolean) => unknown;
};

export function setRestoredEditorContent(editor: EditorContentCommands, content: string | JSONContent) {
  editor.commands.setContent(content, false);
}

export function setWorkbenchEditorEditable(editor: RestorableEditor, editable: boolean) {
  editor.setEditable(editable, false);
}

function plainParagraphsFromHtml(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  const blockTags = new Set(["ADDRESS", "ARTICLE", "BLOCKQUOTE", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "P", "PRE", "SECTION", "TR"]);
  const readNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    if (node.tagName === "BR") return "\n";
    const content = Array.from(node.childNodes).map(readNode).join("");
    return blockTags.has(node.tagName) ? `${content}\n` : content;
  };
  const plain = Array.from(root.childNodes).map(readNode).join("").replace(/\u00a0/g, " ").trim();
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return plain.split(/\n+/).map((line) => `<p>${escape(line) || "<br>"}</p>`).join("");
}

export function SmartOnePageAction({ active, onToggle, disabled }: { active: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <Button
      aria-pressed={active}
      className={`workbench-action workbench-smart-action${active ? " is-active" : ""}`}
      disabled={disabled}
      icon={<Sparkles aria-hidden="true" size={16} />}
      onClick={onToggle}
      size="sm"
      title="智能一页"
      variant="secondary"
    >
      智能一页
    </Button>
  );
}

export function PageArrangementControl({
  value,
  onChange,
  disabled,
  disabledReason,
}: {
  value: PageArrangement;
  onChange: (value: PageArrangement) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const nextValue: PageArrangement = value === "vertical" ? "horizontal" : "vertical";
  const currentLabel = value === "vertical" ? "上下排列" : "左右排列";
  const nextLabel = nextValue === "vertical" ? "上下排列" : "左右排列";
  return (
    <button
      type="button"
      aria-label={`当前${currentLabel}，切换为${nextLabel}`}
      className="workbench-page-arrangement"
      disabled={disabled}
      onClick={() => onChange(nextValue)}
      title={disabled ? disabledReason ?? "当前不可调整页面排列" : `切换为${nextLabel}`}
    >
      <PageArrangementIcon arrangement={value} />
    </button>
  );
}

function PageArrangementIcon({ arrangement }: { arrangement: PageArrangement }) {
  return (
    <svg
      aria-hidden="true"
      className="workbench-page-arrangement-icon"
      data-arrangement={arrangement}
      fill="none"
      viewBox="0 0 18 18"
    >
      {arrangement === "vertical" ? (
        <>
          <path d="M7 2.5H4v5h10v-5h-3" />
          <path d="M7 15.5H4v-5h10v5h-3" />
        </>
      ) : (
        <>
          <path d="M2.5 7V4h5v10h-5v-3" />
          <path d="M15.5 7V4h-5v10h5v-3" />
        </>
      )}
    </svg>
  );
}

type WorkbenchSaveStatusProps = {
  saveStatus: "idle" | "saving" | "saved" | "error";
  dirty: boolean;
};

export function WorkbenchSaveStatus({ saveStatus, dirty }: WorkbenchSaveStatusProps) {
  const kind = saveStatus === "saving"
    ? "saving"
    : saveStatus === "error"
      ? "error"
      : dirty
        ? "editing"
        : "saved";
  const label = kind === "saving"
    ? "保存中…"
    : kind === "error"
      ? "保存失败 · 请重试"
      : kind === "editing"
        ? "编辑中"
        : "已保存";

  return (
    <span aria-live="polite" className={`workbench-save-status ${kind}`} role="status">
      {kind === "saving"
        ? <LoaderCircle aria-hidden="true" className="workbench-status-spinner" />
        : kind === "saved"
          ? <CircleCheck aria-hidden="true" />
          : <i aria-hidden="true" />}
      {label}
    </span>
  );
}

export function SaveVersionAction({ pending, onSave }: { pending: boolean; onSave: () => void }) {
  return (
    <Button
      aria-label={pending ? "正在保存版本" : "保存版本"}
      className="workbench-action workbench-save-action"
      disabled={pending}
      icon={pending ? <LoaderCircle aria-hidden="true" className="workbench-save-spinner" /> : <Save aria-hidden="true" />}
      size="sm"
      onClick={onSave}
    >
      {pending ? "保存中…" : "保存版本"}
    </Button>
  );
}

export function ExportPdfAction({ onExport, pending = false }: { onExport: () => void; pending?: boolean }) {
  return (
    <Button
      aria-label={pending ? "正在导出 PDF" : "导出 PDF"}
      className="workbench-action workbench-export-action"
      disabled={pending}
      icon={pending
        ? <LoaderCircle aria-hidden="true" className="workbench-save-spinner" />
        : <FileDown aria-hidden="true" />}
      size="sm"
      title={pending ? "正在导出 PDF" : "导出 PDF"}
      variant="secondary"
      onClick={onExport}
    >
      {pending ? "导出中…" : "导出 PDF"}
    </Button>
  );
}

export function ImportWarningBanner({ warnings, onDismiss }: { warnings: string[]; onDismiss: () => void }) {
  return (
    <div className="workbench-import-warning" role="status">
      <AlertTriangle size={16} aria-hidden="true" />
      <div>
        <strong>请检查导入结果</strong>
        <p>{warnings.map(importWarningMessage).join("；")}</p>
      </div>
      <button type="button" aria-label="关闭导入质量提示" onClick={onDismiss}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

export function steppedSettingValue(value: number, direction: -1 | 1, min: number, max: number, step: number) {
  const precision = Math.max(0, step.toString().split(".")[1]?.length ?? 0);
  return Math.min(max, Math.max(min, Number((value + direction * step).toFixed(precision))));
}

export function SettingsSlider({ label, unit, value, min, max, step, onChange, disabled }: { label: string; unit: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <div className="workbench-slider-row">
      <span className="workbench-slider-head">
        <span>{label}</span>
        <output>{value} {unit}</output>
      </span>
      <div className="workbench-slider-control">
        <button type="button" aria-label={`${label}减小`} disabled={disabled || value <= min} onClick={() => onChange(steppedSettingValue(value, -1, min, max, step))}><Minus aria-hidden="true" size={14} /></button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <button type="button" aria-label={`${label}增大`} disabled={disabled || value >= max} onClick={() => onChange(steppedSettingValue(value, 1, min, max, step))}><Plus aria-hidden="true" size={14} /></button>
      </div>
    </div>
  );
}

export function FontPreviewSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  const selectedFont = fontOptions.find((font) => font.value === value) ?? fontOptions[0];

  return (
    <div className="workbench-field">
      <span id={labelId}>字体</span>
      <Select value={selectedFont.value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="workbench-font-select" aria-labelledby={labelId}>
          <span className="workbench-font-current">
            <strong>{selectedFont.label}</strong>
            <span style={{ fontFamily: selectedFont.value }}>{FONT_PREVIEW_TEXT}</span>
          </span>
        </SelectTrigger>
        <SelectContent className="workbench-font-select-content" data-ui-theme="light" position="popper">
          {fontOptions.map((font) => (
            <SelectItem className="workbench-font-option" key={font.label} value={font.value}>
              <span className="workbench-font-option-copy">
                <strong>{font.label}</strong>
                <span style={{ fontFamily: font.value }}>{FONT_PREVIEW_TEXT}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ResumeWorkbench() {
  const activeResumeId = useResumeStore((state) => state.activeResumeId);
  const importWarningsByResumeId = useResumeStore((state) => state.importWarningsByResumeId);
  const dismissImportWarnings = useResumeStore((state) => state.dismissImportWarnings);
  const title = useResumeStore((state) => state.title);
  const setTitle = useResumeStore((state) => state.setTitle);
  const editorContent = useResumeStore((state) => state.editorContent);
  const markdown = useResumeStore((state) => state.markdown);
  const setEditorContent = useResumeStore((state) => state.setEditorContent);
  const settings = useResumeStore((state) => state.settings);
  const updateSettings = useResumeStore((state) => state.updateSettings);
  const previewScale = useResumeStore((state) => state.previewScale);
  const setPreviewScale = useResumeStore((state) => state.setPreviewScale);
  const saveStatus = useResumeStore((state) => state.saveStatus);
  const dirty = useResumeStore((state) => state.dirty);
  const saveCurrentResume = useResumeStore((state) => state.saveCurrentResume);
  const versions = useResumeStore((state) => state.versions);
  const versionsLoading = useResumeStore((state) => state.versionsLoading);
  const versionOperationPending = useResumeStore((state) => state.versionOperationPending);
  const loadVersions = useResumeStore((state) => state.loadVersions);
  const createVersion = useResumeStore((state) => state.createVersion);
  const renameStoredVersion = useResumeStore((state) => state.renameVersion);
  const deleteStoredVersion = useResumeStore((state) => state.deleteVersion);
  const restoreStoredVersion = useResumeStore((state) => state.restoreVersion);
  const goHome = useResumeStore((state) => state.goHome);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [pendingVersionDelete, setPendingVersionDelete] = useState<{
    versionNo: number;
    createdAt: string;
  } | null>(null);
  const [versionNameDialogOpen, setVersionNameDialogOpen] = useState(false);
  const [pdfExportPending, setPdfExportPending] = useState(false);
  const [versionName, setVersionName] = useState("");
  const [versionNameError, setVersionNameError] = useState<string | null>(null);
  const [versionNameSubmitting, setVersionNameSubmitting] = useState(false);
  const [versionRenameSubmitting, setVersionRenameSubmitting] = useState<number | null>(null);
  const [versionRenameError, setVersionRenameError] = useState<{ versionNo: number; message: string } | null>(null);
  const [pendingVersionRestore, setPendingVersionRestore] = useState<{ version_no: number; name: string; created_at: string } | null>(null);
  const [commandMenu, setCommandMenu] = useState<CommandMenuState | null>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(() => window.innerWidth);
  const [horizontalScaleOverride, setHorizontalScaleOverride] = useState<number | null>(null);
  const [pageArrangement, setPageArrangement] = useState<PageArrangement>(() => {
    try {
      return window.localStorage.getItem(PAGE_ARRANGEMENT_STORAGE_KEY) === "horizontal" ? "horizontal" : "vertical";
    } catch {
      return "vertical";
    }
  });
  const paperScrollRef = useRef<HTMLDivElement>(null);
  const arrangementAnimationRef = useRef<Animation | null>(null);
  const lastPageAnchorRef = useRef<ReturnType<typeof capturePageViewportAnchor> | null>(null);
  const arrangementLayoutRunRef = useRef(0);

  const changePageArrangement = (value: PageArrangement) => {
    if (value === pageArrangement) return;
    const layoutRun = ++arrangementLayoutRunRef.current;
    const scrollArea = paperScrollRef.current;
    const paper = scrollArea?.querySelector<HTMLElement>(".resume-paper:not(.pagination-measure-paper)") ?? null;
    const anchor = scrollArea && paper
      ? capturePageViewportAnchor(
        pageViewportMetrics(scrollArea, paper, pageArrangement, renderedPreviewScale),
        lastPageAnchorRef.current?.pageIndex,
      )
      : null;
    if (anchor) lastPageAnchorRef.current = anchor;
    const nextScale = value === "horizontal" ? horizontalAutoFitScale : previewScale * responsiveFitScale;
    const applyArrangement = () => new Promise<void>((resolve) => {
      flushSync(() => {
        if (value === "horizontal") setHorizontalScaleOverride(null);
        setPageArrangement(value);
      });
      try {
        window.localStorage.setItem(PAGE_ARRANGEMENT_STORAGE_KEY, value);
      } catch {
        // The view preference remains active for this session when storage is unavailable.
      }
      requestAnimationFrame(() => {
        const expectsHorizontal = value === "horizontal";
        if (
          arrangementLayoutRunRef.current === layoutRun
          && anchor
          && scrollArea
          && scrollArea.classList.contains("pages-horizontal") === expectsHorizontal
        ) {
          const nextPaper = scrollArea.querySelector<HTMLElement>(".resume-paper:not(.pagination-measure-paper)");
          if (nextPaper) {
            const nextPosition = restorePageViewportAnchor(
              pageViewportMetrics(scrollArea, nextPaper, value, nextScale),
              anchor,
            );
            scrollArea.scrollTo(nextPosition);
          }
        }
        resolve();
      });
    });
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    arrangementAnimationRef.current?.cancel();
    const canAnimate = !reduceMotion && paper && typeof paper.animate === "function";
    if (paper) {
      paper.dataset.arrangementTransition = String(layoutRun);
    }
    const exitOffset = value === "horizontal" ? { x: -28, y: 0 } : { x: 0, y: -24 };
    const enterOffset = value === "horizontal" ? { x: 20, y: 0 } : { x: 0, y: 18 };
    const transitionAnimation = canAnimate
      ? paper.animate([
        { offset: 0, opacity: 1, transform: "none", easing: "cubic-bezier(0.4, 0, 1, 1)" },
        {
          offset: 0.42,
          opacity: 0.66,
          transform: `translate3d(${exitOffset.x}px, ${exitOffset.y}px, 0) scale(0.985)`,
          easing: "linear",
        },
        {
          offset: 0.5,
          opacity: 0.66,
          transform: `translate3d(${enterOffset.x}px, ${enterOffset.y}px, 0) scale(0.985)`,
          easing: "cubic-bezier(0, 0, 0.2, 1)",
        },
        { offset: 1, opacity: 1, transform: "none" },
      ], {
        duration: 360,
      })
      : null;
    arrangementAnimationRef.current = transitionAnimation;

    const switchAtMotionMidpoint = transitionAnimation
      ? new Promise<void>((resolve) => window.setTimeout(resolve, 160))
      : Promise.resolve();
    void switchAtMotionMidpoint.then(() => {
      if (arrangementLayoutRunRef.current !== layoutRun) return;
      return applyArrangement();
    });
    const transitionFinished = transitionAnimation?.finished.catch(() => undefined)
      ?? new Promise<void>((resolve) => window.setTimeout(resolve, 120));
    void transitionFinished.finally(() => {
      if (arrangementLayoutRunRef.current !== layoutRun) return;
      if (paper?.dataset.arrangementTransition === String(layoutRun)) {
        delete paper.dataset.arrangementTransition;
        paper.dispatchEvent(new Event("resume-arrangement-transition-end"));
      }
      if (arrangementAnimationRef.current === transitionAnimation) arrangementAnimationRef.current = null;
    });
  };

  const responsiveFitScale = viewportWidth <= 720
    ? Math.min(1, Math.max(0.36, (viewportWidth - 32) / A4_WIDTH_IN_CSS_PIXELS))
    : 1;
  const horizontalPadding = viewportWidth <= 720 ? 32 : viewportWidth <= 980 ? 48 : 96;
  const horizontalAutoFitScale = getTwoPageFitScale(workspaceWidth, horizontalPadding);
  const horizontalMode = pageArrangement === "horizontal" && !settings.smartOnePage;
  const renderedPreviewScale = horizontalMode
    ? horizontalScaleOverride ?? horizontalAutoFitScale
    : previewScale * responsiveFitScale;

  const editor = useEditor({
    extensions: [
      ...resumeEditorExtensions,
      PaginationExtension,
      BlankLineMenuExtension.configure({ onOpen: setCommandMenu }),
    ],
    content: editorContent,
    editorProps: {
      attributes: { class: "resume-content", spellcheck: "false" },
      transformPastedHTML: plainParagraphsFromHtml,
    },
    onCreate: ({ editor: current }) => {
      current.commands.setTextSelection(Math.max(1, current.state.doc.content.size - 1));
      current.commands.blur();
    },
    onUpdate: ({ editor: current }) => {
      setEditorContent(current.getJSON());
      const { from, $from } = current.state.selection;
      if (!current.state.selection.empty) {
        setCommandMenu(null);
        return;
      }
      const line = current.state.doc.textBetween($from.start(), from, "\n", "\ufffc");
      const match = line.match(/(?:^|\s)\/([^\s/]*)$/u);
      if (!match) {
        setCommandMenu((menu) => menu?.replaceRange ? null : menu);
        return;
      }
      const query = match[1] ?? "";
      const slashFrom = from - query.length - 1;
      const coordinates = current.view.coordsAtPos(from);
      setCommandMenu({
        x: Math.max(12, Math.min(coordinates.left, window.innerWidth - 312)),
        y: Math.max(12, Math.min(coordinates.bottom + 6, window.innerHeight - 432)),
        query,
        replaceRange: { from: slashFrom, to: from },
      });
    },
  }, [activeResumeId]);

  useEffect(() => {
    if (editor) setWorkbenchEditorEditable(editor, !versionOperationPending);
  }, [editor, versionOperationPending]);

  useEffect(() => {
    let cancelled = false;
    if (!activeResumeId) return;

    void loadVersions()
      .catch(() => {
        if (!cancelled) setToast({ label: "版本记录暂时无法读取" });
      });

    return () => {
      cancelled = true;
    };
  }, [activeResumeId, loadVersions]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const scrollArea = paperScrollRef.current;
    if (!scrollArea) return;

    const handleWheel = (event: WheelEvent) => {
      if (horizontalMode) {
        const nextScale = getWheelZoomScale(renderedPreviewScale, event, { minScale: 0.1 });
        if (nextScale === null) return;
        event.preventDefault();
        setHorizontalScaleOverride(nextScale);
        return;
      }
      handleWheelZoom(previewScale, event, setPreviewScale);
    };

    scrollArea.addEventListener("wheel", handleWheel, { passive: false });
    return () => scrollArea.removeEventListener("wheel", handleWheel);
  }, [horizontalMode, previewScale, renderedPreviewScale, setPreviewScale]);

  useEffect(() => {
    const scrollArea = paperScrollRef.current;
    if (!scrollArea || typeof ResizeObserver === "undefined") return;
    const updateWorkspaceWidth = () => {
      setWorkspaceWidth(scrollArea.clientWidth);
      if (pageArrangement === "horizontal") setHorizontalScaleOverride(null);
    };
    const observer = new ResizeObserver(updateWorkspaceWidth);
    observer.observe(scrollArea);
    updateWorkspaceWidth();
    return () => observer.disconnect();
  }, [pageArrangement]);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  useEffect(() => () => {
    arrangementLayoutRunRef.current += 1;
    arrangementAnimationRef.current?.cancel();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerMode(null);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);

  const resumeStyle = useMemo(() => ({
    "--resume-font-family": settings.fontFamily,
    "--resume-font-size": `${settings.fontSize}pt`,
    "--resume-line-height": settings.lineHeight,
    "--resume-page-margin-x": `${settings.pageMargin}mm`,
    "--resume-page-margin-y": `${settings.verticalPageMargin}mm`,
  }) as React.CSSProperties, [settings]);

  const openVersionNameDialog = () => {
    setVersionName("");
    setVersionNameError(null);
    setVersionNameDialogOpen(true);
  };

  const closeVersionNameDialog = () => {
    if (versionNameSubmitting) return;
    setVersionNameDialogOpen(false);
    setVersionNameError(null);
  };

  const startVersionRename = () => {
    setVersionRenameError(null);
  };

  const submitVersionRename = async (versionNo: number, nextName: string) => {
    if (!activeResumeId || versionRenameSubmitting !== null) return;
    setVersionRenameSubmitting(versionNo);
    setVersionRenameError(null);
    try {
      await renameStoredVersion(versionNo, nextName);
      setToast({ label: `已将版本 ${versionNo} 重命名为“${nextName}”` });
    } catch (error) {
      setVersionRenameError({ versionNo, message: versionRenameErrorMessage(error) });
      throw error;
    } finally {
      setVersionRenameSubmitting(null);
    }
  };

  const manualSave = async () => {
    if (!editor || versionNameSubmitting) return;
    const validationMessage = versionNameValidationMessage(versionName);
    if (validationMessage) {
      setVersionNameError(validationMessage);
      return;
    }
    const normalizedName = normalizeVersionName(versionName);
    setVersionNameError(null);
    setVersionNameSubmitting(true);
    await saveCurrentResume();
    if (useResumeStore.getState().error) {
      setToast({ label: "保存失败，请稍后重试" });
      setVersionNameSubmitting(false);
      return;
    }
    try {
      await createVersion(normalizedName);
      setVersionNameDialogOpen(false);
      setToast({ label: "已保存新版本" });
    } catch (error) {
      const limitMessage = versionOperationErrorMessage(error, "create");
      if (limitMessage) setDrawerMode("history");
      setToast({ label: limitMessage ?? "当前内容已保存，但版本创建失败" });
    } finally {
      setVersionNameSubmitting(false);
    }
  };

  const restoreVersion = async (versionNo: number, createdAt: string) => {
    if (!editor) return false;
    setWorkbenchEditorEditable(editor, false);
    try {
      await restoreStoredVersion(versionNo);
      const restored = useResumeStore.getState().editorContent;
      setRestoredEditorContent(editor, restored);
      setToast({ label: `已恢复 ${versionTime(createdAt)} 的版本` });
      return true;
    } catch {
      setToast({ label: "版本恢复失败，请稍后重试" });
      return false;
    } finally {
      setWorkbenchEditorEditable(editor, true);
    }
  };

  const confirmDeleteVersion = async () => {
    if (!pendingVersionDelete) return;
    try {
      await deleteStoredVersion(pendingVersionDelete.versionNo);
      setPendingVersionDelete(null);
      setToast({ label: "旧版本已删除，现在可以保存新版本" });
    } catch {
      setToast({ label: "版本删除失败，请稍后重试" });
    }
  };

  const leaveSafely = async () => {
    if (dirty) {
      await saveCurrentResume();
      if (useResumeStore.getState().error) {
        setToast({ label: "保存失败，已留在当前页面，请重试" });
        return;
      }
    }
    goHome();
    navigateTo("/resumes");
  };

  const zoomPercent = Math.round(renderedPreviewScale * 100);
  const importWarnings = activeResumeId
    ? importWarningsByResumeId[activeResumeId] ?? EMPTY_IMPORT_WARNINGS
    : EMPTY_IMPORT_WARNINGS;

  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", bounce: 0, duration: 0.34 }}>
      <div className="resume-workbench" data-ui-theme="light">
        <header className="workbench-header">
          <div className="workbench-header-left">
            <IconButton className="workbench-icon-action workbench-back-action" label="返回全部简历" onClick={() => void leaveSafely()}><Home size={16} /></IconButton>
            <span className="workbench-context-label">简历编辑</span>
          </div>
          <div className="workbench-header-center">
            <input autoComplete="off" className="workbench-title" name="resume-title" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="简历标题" disabled={versionOperationPending} />
            <WorkbenchSaveStatus dirty={dirty} saveStatus={saveStatus} />
          </div>
          <div className="workbench-header-actions">
            <output className="workbench-zoom" aria-label="简历缩放比例">{zoomPercent}%</output>
            <div className="workbench-header-tool-group" role="group" aria-label="编辑面板">
              <PageArrangementControl
                value={pageArrangement}
                onChange={changePageArrangement}
                disabled={settings.smartOnePage || versionOperationPending}
                disabledReason={settings.smartOnePage ? "关闭智能一页后可调整页面排列" : "版本操作完成后可调整页面排列"}
              />
              <IconButton aria-controls="workbench-side-panel" aria-expanded={drawerMode === "settings"} aria-pressed={drawerMode === "settings"} className={`workbench-icon-action${drawerMode === "settings" ? " is-active" : ""}`} label="页面设置" onClick={() => setDrawerMode((mode) => mode === "settings" ? null : "settings")}><SlidersHorizontal size={16} /></IconButton>
              <IconButton aria-controls="workbench-side-panel" aria-expanded={drawerMode === "history"} aria-pressed={drawerMode === "history"} className={`workbench-icon-action${drawerMode === "history" ? " is-active" : ""}`} label="版本记录" onClick={() => setDrawerMode((mode) => mode === "history" ? null : "history")}><History size={16} /></IconButton>
            </div>
            <div className="workbench-output-actions" role="group" aria-label="保存与导出">
              <SmartOnePageAction
                active={settings.smartOnePage}
                onToggle={() => updateSettings({ smartOnePage: !settings.smartOnePage })}
                disabled={versionOperationPending}
              />
              <ExportPdfAction
                pending={pdfExportPending}
                onExport={() => {
                  if (!editor || pdfExportPending) return;
                  const content = editor.getJSON();
                  setPdfExportPending(true);
                  setToast({ label: "正在生成 PDF…" });
                  void import("../preview/exportTextPdf")
                    .then(({ exportResumeTextPdf }) => exportResumeTextPdf(content, settings, title))
                    .then(() => setToast({ label: "PDF 已下载" }))
                    .catch(() => setToast({ label: "PDF 生成失败，请检查简历中的图片后重试" }))
                    .finally(() => setPdfExportPending(false));
                }}
              />
              <SaveVersionAction pending={saveStatus === "saving" || versionOperationPending || versionNameSubmitting} onSave={openVersionNameDialog} />
            </div>
          </div>
        </header>

        {activeResumeId && importWarnings.length > 0 && (
          <ImportWarningBanner
            warnings={importWarnings}
            onDismiss={() => dismissImportWarnings(activeResumeId)}
          />
        )}

        {activeResumeId && editor && (
          <StableWorkbenchBubbleMenu editor={editor}>
            <WorkbenchToolbar editor={editor} resumeId={activeResumeId} defaultFontSize={settings.fontSize} onNotice={(label) => setToast({ label })} />
          </StableWorkbenchBubbleMenu>
        )}

        {activeResumeId && editor && commandMenu && (
          <SlashCommandMenu
            editor={editor}
            resumeId={activeResumeId}
            state={commandMenu}
            onClose={() => setCommandMenu(null)}
            onNotice={(label) => setToast({ label })}
          />
        )}

        <main className="workbench-canvas">
          <div
            ref={paperScrollRef}
            className={`workbench-paper-scroll${pageArrangement === "horizontal" && !settings.smartOnePage ? " pages-horizontal" : ""}`}
            style={{ "--workbench-preview-scale": renderedPreviewScale } as React.CSSProperties}
          >
            <article className={`resume-paper theme-${settings.theme}${settings.smartOnePage ? " smart-one-page" : ""}${pageArrangement === "horizontal" && !settings.smartOnePage ? " pages-horizontal" : ""}`} style={resumeStyle} aria-label="可编辑简历页面">
              <EditorContent editor={editor} />
            </article>
          </div>

          <AnimatePresence initial={false}>
            {drawerMode && (
              <motion.aside
                id="workbench-side-panel"
                className="workbench-drawer"
                role="region"
                aria-labelledby="workbench-drawer-title"
                initial={{ x: 360 }}
                animate={{ x: 0 }}
                exit={{ x: 360 }}
                transition={{ type: "spring", bounce: 0, duration: 0.36 }}
              >
                <div className="workbench-drawer-head">
                  <div>
                    <h2 id="workbench-drawer-title">{drawerMode === "settings" ? "页面设置" : "版本记录"}</h2>
                    <p>{drawerMode === "settings" ? "只在需要时打开，关闭后不占用工作区。" : "每次手动保存都会留下一个可恢复版本。"}</p>
                  </div>
                  <button type="button" className="workbench-drawer-done" onClick={() => setDrawerMode(null)} aria-label="关闭面板">完成</button>
                </div>
                {drawerMode === "settings" ? (
                  <div className="workbench-settings">
                    <FontPreviewSelect value={settings.fontFamily} onChange={(fontFamily) => updateSettings({ fontFamily })} disabled={versionOperationPending} />
                    <SettingsSlider label="正文字号" unit="pt" value={settings.fontSize} min={8} max={16} step={0.5} onChange={(fontSize) => updateSettings({ fontSize })} disabled={versionOperationPending} />
                    <SettingsSlider label="行距" unit="" value={settings.lineHeight} min={1.1} max={1.8} step={0.05} onChange={(lineHeight) => updateSettings({ lineHeight })} disabled={versionOperationPending} />
                    <SettingsSlider label="左右边距" unit="mm" value={settings.pageMargin} min={10} max={30} step={2} onChange={(pageMargin) => updateSettings({ pageMargin })} disabled={versionOperationPending} />
                    <SettingsSlider label="上下边距" unit="mm" value={settings.verticalPageMargin} min={10} max={30} step={2} onChange={(verticalPageMargin) => updateSettings({ verticalPageMargin })} disabled={versionOperationPending} />
                    <button
                      type="button"
                      className="workbench-reset-settings"
                      disabled={versionOperationPending}
                      onClick={() => {
                        changePageArrangement("vertical");
                        updateSettings({
                          fontFamily: defaultSettings.fontFamily,
                          fontSize: defaultSettings.fontSize,
                          lineHeight: defaultSettings.lineHeight,
                          pageMargin: defaultSettings.pageMargin,
                          verticalPageMargin: defaultSettings.verticalPageMargin,
                          smartOnePage: defaultSettings.smartOnePage,
                        });
                      }}
                    >
                      恢复默认设置
                    </button>
                  </div>
                ) : (
                  <div className="workbench-versions">
                    <p className="workbench-version-summary">
                      <strong>{versions.length} 个版本</strong>
                      <span>正式保存 · 自动保存不计入</span>
                    </p>
                    {versionsLoading && <PageLoading label="正在读取版本记录…" scope="panel" />}
                    {!versionsLoading && versions.length === 0 && <p className="workbench-empty">暂无可用版本。</p>}
                    {versions.map((version) => (
                      <div className="version-row" key={version.id}>
                        <div className="version-row-copy">
                          <VersionRenameAction
                            name={version.name}
                            versionNo={version.version_no}
                            disabled={versionOperationPending || (versionRenameSubmitting !== null && versionRenameSubmitting !== version.version_no)}
                            busy={versionRenameSubmitting === version.version_no}
                            error={versionRenameError?.versionNo === version.version_no ? versionRenameError.message : null}
                            onStartRename={startVersionRename}
                            onRename={(nextName) => submitVersionRename(version.version_no, nextName)}
                          />
                          <span>版本 {version.version_no} · {versionTime(version.created_at)} · {versionReasonLabels[version.reason]}</span>
                        </div>
                        <span className="version-row-actions">
                          <button type="button" disabled={versionOperationPending} onClick={() => setPendingVersionRestore(version)}>恢复</button>
                          {version.version_no !== versions[0]?.version_no && (
                            <button
                              type="button"
                              className="version-delete-action"
                              aria-label={`删除版本 v${version.version_no}`}
                              disabled={versionOperationPending}
                              onClick={() => setPendingVersionDelete({ versionNo: version.version_no, createdAt: version.created_at })}
                            >
                              删除
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                    <p className="workbench-version-footnote">自动保存不会创建正式版本；恢复会直接替换当前编辑内容。</p>
                  </div>
                )}
              </motion.aside>
            )}
          </AnimatePresence>
        </main>

        <AnimatePresence>
          {toast && (
            <motion.div className="workbench-toast" role="status" initial={{ opacity: 0, scale: 0.9, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: -6 }}>
              <CircleCheck size={18} />{toast.label}
            </motion.div>
          )}
        </AnimatePresence>

        {activeResumeId ? (
          <VersionDiffDialog
            open={Boolean(pendingVersionRestore)}
            resumeId={activeResumeId}
            version={pendingVersionRestore}
            currentMarkdown={markdown}
            currentSettings={settings}
            restoring={versionOperationPending}
            onOpenChange={(open) => {
              if (!open) setPendingVersionRestore(null);
            }}
            onConfirm={async () => {
              if (!pendingVersionRestore) return;
              const restored = await restoreVersion(pendingVersionRestore.version_no, pendingVersionRestore.created_at);
              if (restored) setPendingVersionRestore(null);
            }}
          />
        ) : null}

        {pendingVersionDelete && (
          <ConfirmDialog
            kind="delete"
            title={`删除版本 v${pendingVersionDelete.versionNo}？`}
            description={`将永久删除 ${versionTime(pendingVersionDelete.createdAt)} 保存的历史版本，不会影响当前简历内容。`}
            confirmLabel="永久删除"
            busyLabel="正在删除…"
            busy={versionOperationPending}
            onCancel={() => setPendingVersionDelete(null)}
            onConfirm={confirmDeleteVersion}
          />
        )}

        <Dialog
          open={versionNameDialogOpen}
          onOpenChange={(open) => (open ? setVersionNameDialogOpen(true) : closeVersionNameDialog())}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>保存正式版本</DialogTitle>
              <DialogDescription>为这个重要节点命名，之后可以从版本记录中恢复。</DialogDescription>
            </DialogHeader>
            <form className="version-name-form" onSubmit={(event) => { event.preventDefault(); void manualSave(); }}>
              <div className="version-name-field">
                <Label htmlFor="resume-version-name">版本名称</Label>
                <Input
                  id="resume-version-name"
                  autoFocus
                  maxLength={MAX_VERSION_NAME_LENGTH}
                  placeholder="例如：投递产品经理岗位"
                  value={versionName}
                  aria-invalid={versionNameError ? "true" : undefined}
                  aria-describedby={versionNameError ? "resume-version-name-error" : "resume-version-name-help"}
                  onChange={(event) => {
                    setVersionName(event.target.value);
                    if (versionNameError) setVersionNameError(null);
                  }}
                />
                {versionNameError ? (
                  <p className="version-name-error" id="resume-version-name-error" role="alert">{versionNameError}</p>
                ) : (
                  <p className="version-name-help" id="resume-version-name-help">名称只用于区分正式保存的简历节点。</p>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={closeVersionNameDialog} disabled={versionNameSubmitting}>取消</Button>
                <Button type="submit" variant="accent" disabled={versionNameSubmitting}>{versionNameSubmitting ? "保存中…" : "保存版本"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

      </div>
    </MotionConfig>
  );
}

function importWarningMessage(warning: string) {
  const messages: Record<string, string> = {
    pdf_ocr_applied: "PDF 已使用 OCR，请核对姓名、日期和数字",
    pdf_low_text_quality: "PDF 文本质量偏低，请重点核对遗漏和错字",
    docx_embedded_images_omitted: "DOCX 中的图片未导入",
    docx_textbox_order_may_change: "DOCX 文本框的阅读顺序可能发生变化",
    document_heading_structure_missing: "原文缺少明确章节标题，已按全文识别",
    source_quote_not_found: "部分结构化内容无法定位到原文短句",
    unparsed_work_start_date: "部分工作开始日期未能识别",
    unparsed_work_end_date: "部分工作结束日期未能识别",
    unmapped_fragments_preserved: "部分未分类内容已保留，请人工整理",
  };
  return messages[warning] ?? "部分内容需要人工核对";
}
