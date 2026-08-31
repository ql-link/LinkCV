import { posToDOMRect, type Editor, type JSONContent } from "@tiptap/core";
import { BubbleMenu, EditorContent, useEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  AlertTriangle,
  CircleCheck,
  Columns2,
  FileDown,
  Home,
  LayoutTemplate,
  LoaderCircle,
  Minus,
  Pencil,
  Plus,
  Rows3,
  Save,
  SlidersHorizontal,
  Sparkles,
  Type,
  RefreshCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Instance as TippyInstance } from "tippy.js";
import { api, ApiRequestError, type ResumeTemplate } from "../../api/client";
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
import { resumeSerifFontStack, useResumeStore } from "../../store/resumeStore";
import { resumeEditorExtensions } from "./editorExtensions";
import { SelectionFormattingToolbar } from "./WorkbenchToolbar";
import {
  createSelectionBubbleAnchor,
  refreshSelectionBubblePosition,
  shouldShowSelectionAgentBubble,
} from "./selectionBubbleAnchor";
import { getTwoPageFitScale, getWheelZoomScale, handleWheelZoom } from "./workbenchZoom";
import { navigateTo } from "../../routing";
import { AgentPanel, type AgentSelectionDraft } from "../agent/AgentPanel";
import {
  LineInsertMenuExtension,
  SlashCommandMenu,
  type CommandMenuState,
} from "./slashCommand";
import { VersionDiffDialog } from "./VersionDiffDialog";
import { evaluateResumeCompleteness } from "./resumeCompleteness";
import { ResumeCompletenessAction, ResumeCompletenessPanel } from "./ResumeCompletenessPanel";
import { TemplatePreviewDialog } from "../templates/TemplatePreviewDialog";
import { PaginationExtension } from "./paginationPlugin";
import {
  exportResumePdf,
  isResumePdfExportCancelled,
  resumePdfExportErrorMessage,
} from "../preview/pdfExport";
import {
  capturePageViewportAnchor,
  restorePageViewportAnchor,
  type PageArrangement,
  type PageViewportMetrics,
} from "./pageArrangementTransition";
import { resumeDocumentContentHash } from "../../api/resumeContract";

type DrawerMode = "settings" | "history" | "quality" | "agent" | null;

type AgentFloatingPosition = { left: number; top: number };
type AgentFloatingBounds = { width: number; height: number; entryWidth: number; entryHeight: number };

const AGENT_FLOATING_MARGIN = 8;
const AGENT_DRAG_THRESHOLD = 5;
const AGENT_DRAWER_MIN_WIDTH = 320;
const AGENT_DRAWER_MAX_WIDTH = 640;
const AGENT_DRAWER_DEFAULT_WIDTH = 390;
const AGENT_DRAWER_WIDTH_STORAGE_KEY = "linkcv.workbench.agent-drawer-width";
const WORKBENCH_TITLE_CHARACTER_LIMIT = 30;
const SEMANTIC_KIND_LABELS = {
  profile: "个人信息",
  work: "工作",
  education: "教育",
  project: "项目",
  skills: "技能",
  activity: "活动",
  interests: "兴趣爱好",
  certificates: "证书",
  awards: "荣誉",
  languages: "语言",
  custom: "自定义",
} as const;

export function semanticSectionDisplayTitle(title: string) {
  return title.replace(/:icon\[[^\]]+\]:/gu, "").trim() || "未命名章节";
}

export function truncateWorkbenchTitle(title: string) {
  const characters = Array.from(title);
  return characters.length > WORKBENCH_TITLE_CHARACTER_LIMIT
    ? `${characters.slice(0, WORKBENCH_TITLE_CHARACTER_LIMIT).join("")}…`
    : title;
}

type WorkbenchTitleInputProps = {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
};

export function WorkbenchTitleInput({ value, disabled, onChange }: WorkbenchTitleInputProps) {
  const [focused, setFocused] = useState(false);
  const displayValue = focused ? value : truncateWorkbenchTitle(value);
  const truncated = displayValue !== value;

  return (
    <input
      autoComplete="off"
      className="workbench-title"
      name="resume-title"
      value={displayValue}
      onChange={(event) => onChange(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      aria-label="简历标题"
      disabled={disabled}
      title={truncated ? value : undefined}
    />
  );
}

export function clampAgentDrawerWidth(width: number, viewportWidth: number) {
  return Math.round(Math.min(
    Math.max(AGENT_DRAWER_MIN_WIDTH, width),
    Math.max(AGENT_DRAWER_MIN_WIDTH, Math.min(AGENT_DRAWER_MAX_WIDTH, viewportWidth - 24)),
  ));
}

export function workbenchCanvasClassName(drawerMode: DrawerMode) {
  return `workbench-canvas${drawerMode ? " has-drawer" : ""}${drawerMode === "agent" ? " has-agent-drawer" : ""}`;
}

export function defaultWorkbenchDrawerMode(viewportWidth: number) {
  return viewportWidth > 980 ? "settings" as const : null;
}

export function WorkbenchDesignAction({
  panelOpen,
  onToggle,
}: {
  panelOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      aria-label="设计"
      aria-controls="workbench-side-panel"
      aria-expanded={panelOpen}
      aria-pressed={panelOpen}
      className={`workbench-action workbench-design-action${panelOpen ? " is-active" : ""}`}
      icon={<SlidersHorizontal aria-hidden="true" />}
      size="sm"
      title="设计"
      variant="secondary"
      onClick={onToggle}
    >
      设计
    </Button>
  );
}

export function WorkbenchPanelSwitcher({
  activePanel,
  onSettings,
  onHistory,
  onClose,
}: {
  activePanel: "settings" | "history";
  onSettings: () => void;
  onHistory: () => void;
  onClose: () => void;
}) {
  return (
    <div className="workbench-panel-head">
      <div className="workbench-panel-tabs" role="tablist" aria-label="简历编辑面板">
        <button
          id="workbench-settings-tab"
          type="button"
          role="tab"
          aria-controls="workbench-settings-panel"
          aria-selected={activePanel === "settings"}
          tabIndex={activePanel === "settings" ? 0 : -1}
          className={activePanel === "settings" ? "is-active" : undefined}
          onClick={onSettings}
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "End") return;
            event.preventDefault();
            onHistory();
            document.getElementById("workbench-history-tab")?.focus();
          }}
        >
          页面设置
        </button>
        <button
          id="workbench-history-tab"
          type="button"
          role="tab"
          aria-controls="workbench-history-panel"
          aria-selected={activePanel === "history"}
          tabIndex={activePanel === "history" ? 0 : -1}
          className={activePanel === "history" ? "is-active" : undefined}
          onClick={onHistory}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "Home") return;
            event.preventDefault();
            onSettings();
            document.getElementById("workbench-settings-tab")?.focus();
          }}
        >
          版本记录
        </button>
      </div>
      <button
        type="button"
        className="workbench-drawer-done"
        onClick={onClose}
        aria-label="关闭编辑面板"
      >
        <X aria-hidden="true" size={17} />
      </button>
    </div>
  );
}

export function clampAgentFloatingPosition(
  position: AgentFloatingPosition,
  bounds: AgentFloatingBounds,
): AgentFloatingPosition {
  return {
    left: Math.min(
      Math.max(AGENT_FLOATING_MARGIN, position.left),
      Math.max(AGENT_FLOATING_MARGIN, bounds.width - bounds.entryWidth - AGENT_FLOATING_MARGIN),
    ),
    top: Math.min(
      Math.max(AGENT_FLOATING_MARGIN, position.top),
      Math.max(AGENT_FLOATING_MARGIN, bounds.height - bounds.entryHeight - AGENT_FLOATING_MARGIN),
    ),
  };
}

export function AgentFloatingEntry({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const entryRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [position, setPosition] = useState<AgentFloatingPosition | null>(null);
  const [dragging, setDragging] = useState(false);

  const clampToCanvas = useCallback((nextPosition: AgentFloatingPosition) => {
    const entry = entryRef.current;
    const canvas = entry?.parentElement;
    if (!entry || !canvas) return nextPosition;
    const agentDrawer = open ? canvas.querySelector<HTMLElement>(".workbench-drawer.is-agent") : null;
    const drawerRight = agentDrawer ? Number.parseFloat(window.getComputedStyle(agentDrawer).right) || 0 : 0;
    const availableWidth = agentDrawer
      ? canvas.clientWidth - agentDrawer.offsetWidth - drawerRight
      : canvas.clientWidth;
    return clampAgentFloatingPosition(nextPosition, {
      width: availableWidth,
      height: canvas.clientHeight,
      entryWidth: entry.offsetWidth,
      entryHeight: entry.offsetHeight,
    });
  }, [open]);

  useEffect(() => {
    const keepEntryVisible = () => setPosition((current) => current ? clampToCanvas(current) : current);
    const entry = entryRef.current;
    const canvas = entry?.parentElement;
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(keepEntryVisible);
    keepEntryVisible();
    if (canvas) resizeObserver?.observe(canvas);
    if (entry) resizeObserver?.observe(entry);
    window.addEventListener("resize", keepEntryVisible, { passive: true });
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", keepEntryVisible);
    };
  }, [clampToCanvas, open]);

  const finishDragging = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) suppressClickUntilRef.current = Date.now() + 300;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <motion.button
      ref={entryRef}
      type="button"
      className={`agent-floating-entry${open ? " is-open" : ""}${position ? " has-custom-position" : ""}${dragging ? " is-dragging" : ""}`}
      style={position ?? undefined}
      aria-controls="workbench-side-panel"
      aria-expanded={open}
      aria-label={open ? "收起智能助手" : "打开智能助手"}
      title={open ? "拖动调整位置，点击收起智能助手" : "拖动调整位置，点击打开智能助手"}
      whileTap={{ scale: 0.97 }}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.isPrimary === false) return;
        const canvas = event.currentTarget.parentElement;
        if (!canvas) return;
        const canvasRect = canvas.getBoundingClientRect();
        const entryRect = event.currentTarget.getBoundingClientRect();
        dragRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          left: entryRect.left - canvasRect.left,
          top: entryRect.top - canvasRect.top,
          moved: false,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - drag.clientX;
        const deltaY = event.clientY - drag.clientY;
        if (!drag.moved && Math.hypot(deltaX, deltaY) < AGENT_DRAG_THRESHOLD) return;
        drag.moved = true;
        event.preventDefault();
        setDragging(true);
        setPosition(clampToCanvas({ left: drag.left + deltaX, top: drag.top + deltaY }));
      }}
      onPointerUp={finishDragging}
      onPointerCancel={finishDragging}
      onClick={(event) => {
        if (Date.now() < suppressClickUntilRef.current) {
          suppressClickUntilRef.current = 0;
          event.preventDefault();
          return;
        }
        onToggle();
      }}
    >
      <span className="agent-floating-mark" aria-hidden="true"><Sparkles size={22} /></span>
      <span className="agent-floating-copy"><strong>AI 助手</strong></span>
    </motion.button>
  );
}

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

function StableSelectionToolbarBubble({ editor, children }: { editor: Editor; children: ReactNode }) {
  const anchorRef = useRef<ReturnType<typeof createSelectionBubbleAnchor> | null>(null);
  const tippyRef = useRef<TippyInstance | null>(null);
  if (!anchorRef.current) anchorRef.current = createSelectionBubbleAnchor();
  const anchor = anchorRef.current;

  useEffect(() => {
    const scrollArea = editor.view.dom.closest(".workbench-paper-scroll");
    const refresh = () => {
      refreshSelectionBubblePosition(
        anchor,
        () => currentSelectionRect(editor),
        () => { void tippyRef.current?.popperInstance?.update(); },
      );
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
        placement: "top",
        offset: [0, 8],
        getReferenceClientRect: () => anchor.getRect(() => currentSelectionRect(editor)),
        onCreate: (instance) => { tippyRef.current = instance; },
        onDestroy: (instance) => {
          if (tippyRef.current === instance) tippyRef.current = null;
        },
      }}
      shouldShow={({ editor: current, view, from, to }) => {
        const visible = shouldShowSelectionAgentBubble({
          editable: current.isEditable,
          selectionEmpty: current.state.selection.empty,
          selectionIsText: current.state.selection instanceof TextSelection,
        });
        anchor.observe(
          visible ? { from, to } : { from, to: from },
          () => posToDOMRect(view, from, to),
        );
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
  { label: "系统黑体", value: '"LinkCV Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif' },
];

const versionReasonLabels = {
  initial: "初始版本",
  manual: "手动保存",
  before_restore: "恢复前备份",
  agent: "智能助手修改",
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

export function PageArrangementControl({
  value,
  onChange,
  smartOnePage = false,
  onSmartOnePageChange,
  disabled,
  disabledReason,
}: {
  value: PageArrangement;
  onChange: (value: PageArrangement) => void;
  smartOnePage?: boolean;
  onSmartOnePageChange: (enabled: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div className="workbench-layout-setting">
      <div className="workbench-layout-options" role="group" aria-label="页面排列">
        {(["vertical", "horizontal"] as const).map((arrangement) => {
          const label = arrangement === "vertical" ? "上下排列" : "左右排列";
          return (
            <button
              type="button"
              aria-label={label}
              aria-pressed={!smartOnePage && value === arrangement}
              className={!smartOnePage && value === arrangement ? "is-active" : undefined}
              disabled={disabled}
              key={arrangement}
              onClick={() => {
                if (smartOnePage) onSmartOnePageChange(false);
                onChange(arrangement);
              }}
              title={disabled ? disabledReason ?? "当前不可调整页面排列" : label}
            >
              <span className="workbench-layout-option-preview">
                {arrangement === "vertical"
                  ? <Rows3 aria-hidden="true" data-arrangement={arrangement} />
                  : <Columns2 aria-hidden="true" data-arrangement={arrangement} />}
              </span>
              <strong>{label}</strong>
            </button>
          );
        })}
        <button
          type="button"
          aria-label="智能一页"
          aria-pressed={smartOnePage}
          className={smartOnePage ? "is-active" : undefined}
          disabled={disabled}
          onClick={() => {
            if (!smartOnePage) onSmartOnePageChange(true);
          }}
          title={disabled ? disabledReason ?? "当前不可调整页面布局" : "连续排成单页"}
        >
          <span className="workbench-layout-option-preview"><Sparkles aria-hidden="true" data-arrangement="smart" /></span>
          <strong>智能一页</strong>
        </button>
      </div>
      <small className="workbench-layout-help">
        {disabled
          ? disabledReason ?? "当前不可调整页面布局"
          : smartOnePage
            ? "连续排成单页；导出时保持当前字号与行距。"
            : "排列只影响编辑时的浏览方向。"}
      </small>
    </div>
  );
}

export function ZoomFeedback({ scale }: { scale: number }) {
  return <div className="workbench-zoom-feedback" role="status" aria-live="polite">{Math.round(scale * 100)}%</div>;
}

function WorkbenchSettingsSection({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="workbench-settings-section">
      <header>
        <div className="workbench-settings-section-title">{icon}<h3>{title}</h3></div>
        <p>{description}</p>
      </header>
      <div className="workbench-settings-section-body">{children}</div>
    </section>
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

export function SaveResumeAction({ pending, onSave }: { pending: boolean; onSave: () => void }) {
  return (
    <Button
      aria-label={pending ? "正在保存简历" : "保存简历"}
      className="workbench-action workbench-save-action"
      disabled={pending}
      icon={pending ? <LoaderCircle aria-hidden="true" className="workbench-save-spinner" /> : <Save aria-hidden="true" />}
      size="sm"
      onClick={onSave}
      variant="secondary"
    >
      {pending ? "保存中…" : "保存简历"}
    </Button>
  );
}

export function SaveVersionAction({ pending, onSave }: { pending: boolean; onSave: () => void }) {
  return (
    <div className="workbench-setting-action">
      <span className="workbench-setting-item-icon" aria-hidden="true"><Save size={16} /></span>
      <span className="workbench-setting-toggle-copy">
        <strong>保存版本</strong>
        <small>为当前简历创建一个可命名、可恢复的历史节点。</small>
      </span>
      <Button
        aria-label={pending ? "正在保存版本" : "保存版本"}
        className="workbench-setting-row-action"
        disabled={pending}
        icon={pending ? <LoaderCircle aria-hidden="true" className="workbench-save-spinner" /> : undefined}
        onClick={onSave}
        size="sm"
        variant="secondary"
      >
        {pending ? "保存中…" : "保存版本"}
      </Button>
    </div>
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

export function ResumeTemplateSwitcher({
  currentTemplateKey,
  disabled = false,
  onApply,
}: {
  currentTemplateKey: string;
  disabled?: boolean;
  onApply: (template: ResumeTemplate) => void | Promise<void>;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<ResumeTemplate | null>(null);
  const [templates, setTemplates] = useState<ResumeTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setStatusOpen(true);
    try {
      const result = await api.listResumeTemplates();
      setTemplates(result.templates);
      const initialTemplate = result.templates.find(
        (template) => template.style.template_key === currentTemplateKey,
      ) ?? result.templates[0] ?? null;
      if (initialTemplate) {
        setStatusOpen(false);
        setPreviewTemplate(initialTemplate);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [currentTemplateKey]);

  const openTemplatePreview = () => {
    const initialTemplate = templates.find(
      (template) => template.style.template_key === currentTemplateKey,
    ) ?? templates[0] ?? null;
    if (initialTemplate) {
      setPreviewTemplate(initialTemplate);
      return;
    }
    if (!loading) void loadTemplates();
  };

  return (
    <>
      <Button
        aria-haspopup="dialog"
        aria-label="简历模板"
        className="workbench-action workbench-template-action"
        disabled={disabled}
        icon={<LayoutTemplate aria-hidden="true" />}
        size="sm"
        title="模板"
        variant="secondary"
        onClick={openTemplatePreview}
      >
        模板
      </Button>
      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent className="workbench-template-state-dialog">
          <DialogHeader>
            <DialogTitle>模板预览</DialogTitle>
            <DialogDescription>加载可用模板后，可完整预览并应用到当前简历。</DialogDescription>
          </DialogHeader>
          <div aria-live="polite">
            {loading ? <PageLoading label="正在加载简历模板…" scope="panel" /> : null}
            {!loading && failed ? (
              <div className="workbench-template-state" role="alert">
                <strong>模板暂时无法加载</strong>
                <p>请检查网络后重试，当前简历不会受到影响。</p>
                <Button
                  icon={<RefreshCw aria-hidden="true" size={15} />}
                  onClick={() => void loadTemplates()}
                  size="sm"
                  variant="outline"
                >
                  重新加载
                </Button>
              </div>
            ) : null}
            {!loading && !failed && templates.length === 0 ? (
              <div className="workbench-template-state">
                <strong>当前没有可用模板</strong>
                <p>模板启用后会显示在这里。</p>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <TemplatePreviewDialog
        templates={templates}
        template={previewTemplate}
        primaryActionLabel={(template) => (
          template.style.template_key === currentTemplateKey ? "当前模板" : "应用模板"
        )}
        isPrimaryActionDisabled={(template) => applying || template.style.template_key === currentTemplateKey}
        onTemplateChange={setPreviewTemplate}
        onPrimaryAction={(template) => {
          setApplying(true);
          void Promise.resolve(onApply(template))
            .then(() => setPreviewTemplate(null))
            .catch(() => undefined)
            .finally(() => setApplying(false));
        }}
        onClose={() => setPreviewTemplate(null)}
      />
    </>
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

export const WORKBENCH_VERTICAL_PAGE_MARGIN_MIN_MM = 6;

export function SettingsStepper({ label, unit, value, min, max, step, onChange, disabled }: { label: string; unit: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <div className="workbench-value-row">
      <span>{label}</span>
      <div className="workbench-value-control">
        <button type="button" aria-label={`${label}减小`} disabled={disabled || value <= min} onClick={() => onChange(steppedSettingValue(value, -1, min, max, step))}><Minus aria-hidden="true" size={14} /></button>
        <output aria-label={`${label}当前值`}>{value}{unit ? ` ${unit}` : ""}</output>
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
          <span className="workbench-font-current" style={{ fontFamily: selectedFont.value }}>
            {selectedFont.label}
          </span>
        </SelectTrigger>
        <SelectContent className="workbench-font-select-content" data-ui-theme="light" position="popper">
          {fontOptions.map((font) => (
            <SelectItem className="workbench-font-option" key={font.label} value={font.value}>
              <span className="workbench-font-option-copy" style={{ fontFamily: font.value }}>
                {font.label}
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
  const data = useResumeStore((state) => state.data);
  const style = useResumeStore((state) => state.style);
  const user = useResumeStore((state) => state.user);
  const updateSettings = useResumeStore((state) => state.updateSettings);
  const applyTemplate = useResumeStore((state) => state.applyTemplate);
  const setSectionSemanticKind = useResumeStore((state) => state.setSectionSemanticKind);
  const previewScale = useResumeStore((state) => state.previewScale);
  const setPreviewScale = useResumeStore((state) => state.setPreviewScale);
  const saveStatus = useResumeStore((state) => state.saveStatus);
  const dirty = useResumeStore((state) => state.dirty);
  const saveCurrentResume = useResumeStore((state) => state.saveCurrentResume);
  const versions = useResumeStore((state) => state.versions);
  const versionsLoading = useResumeStore((state) => state.versionsLoading);
  const versionOperationPending = useResumeStore((state) => state.versionOperationPending);
  const loadVersions = useResumeStore((state) => state.loadVersions);
  const loadResume = useResumeStore((state) => state.loadResume);
  const createVersion = useResumeStore((state) => state.createVersion);
  const renameStoredVersion = useResumeStore((state) => state.renameVersion);
  const deleteStoredVersion = useResumeStore((state) => state.deleteVersion);
  const restoreStoredVersion = useResumeStore((state) => state.restoreVersion);
  const goHome = useResumeStore((state) => state.goHome);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(() => defaultWorkbenchDrawerMode(window.innerWidth));
  const [agentDrawerWidth, setAgentDrawerWidth] = useState(() => {
    try {
      const stored = Number.parseFloat(window.localStorage.getItem(AGENT_DRAWER_WIDTH_STORAGE_KEY) ?? "");
      return clampAgentDrawerWidth(Number.isFinite(stored) ? stored : AGENT_DRAWER_DEFAULT_WIDTH, window.innerWidth);
    } catch {
      return AGENT_DRAWER_DEFAULT_WIDTH;
    }
  });
  const [agentDraft, setAgentDraft] = useState<AgentSelectionDraft | null>(null);
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
  const [zoomFeedback, setZoomFeedback] = useState<{ scale: number; sequence: number } | null>(null);
  const [semanticClassificationPending, setSemanticClassificationPending] = useState(false);
  const [pageArrangement, setPageArrangement] = useState<PageArrangement>(() => {
    try {
      return window.localStorage.getItem(PAGE_ARRANGEMENT_STORAGE_KEY) === "horizontal" ? "horizontal" : "vertical";
    } catch {
      return "vertical";
    }
  });
  const paperScrollRef = useRef<HTMLDivElement>(null);
  const arrangementAnimationRef = useRef<Animation | null>(null);
  const pdfExportAbortRef = useRef<AbortController | null>(null);
  const lastPageAnchorRef = useRef<ReturnType<typeof capturePageViewportAnchor> | null>(null);
  const arrangementLayoutRunRef = useRef(0);
  const agentDrawerResizeRef = useRef<{ pointerId: number; clientX: number; width: number; currentWidth: number } | null>(null);
  const completeness = useMemo(() => evaluateResumeCompleteness(markdown), [markdown]);

  const persistAgentDrawerWidth = useCallback((width: number) => {
    const nextWidth = clampAgentDrawerWidth(width, window.innerWidth);
    setAgentDrawerWidth(nextWidth);
    try {
      window.localStorage.setItem(AGENT_DRAWER_WIDTH_STORAGE_KEY, String(nextWidth));
    } catch {
      // Browser privacy settings may disable local storage; resizing still works for this visit.
    }
  }, []);

  useEffect(() => {
    setAgentDrawerWidth((current) => clampAgentDrawerWidth(current, viewportWidth));
  }, [viewportWidth]);

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
  const showZoomFeedback = useCallback((scale: number) => {
    setZoomFeedback({ scale, sequence: Date.now() });
  }, []);

  const editor = useEditor({
    extensions: [
      ...resumeEditorExtensions,
      PaginationExtension,
      LineInsertMenuExtension.configure({ onOpen: setCommandMenu }),
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
    if (!zoomFeedback) return;
    const timer = window.setTimeout(() => setZoomFeedback(null), 900);
    return () => window.clearTimeout(timer);
  }, [zoomFeedback]);

  useEffect(() => {
    const scrollArea = paperScrollRef.current;
    if (!scrollArea) return;

    const handleWheel = (event: WheelEvent) => {
      if (horizontalMode) {
        const nextScale = getWheelZoomScale(renderedPreviewScale, event, { minScale: 0.1 });
        if (nextScale === null) return;
        event.preventDefault();
        setHorizontalScaleOverride(nextScale);
        showZoomFeedback(nextScale);
        return;
      }
      handleWheelZoom(previewScale, event, (nextScale) => {
        setPreviewScale(nextScale);
        showZoomFeedback(nextScale);
      });
    };

    scrollArea.addEventListener("wheel", handleWheel, { passive: false });
    return () => scrollArea.removeEventListener("wheel", handleWheel);
  }, [horizontalMode, previewScale, renderedPreviewScale, setPreviewScale, showZoomFeedback]);

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
    pdfExportAbortRef.current?.abort();
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

  const saveResume = async () => {
    if (!editor || saveStatus === "saving" || versionOperationPending || versionNameSubmitting) return;
    await saveCurrentResume();
    setToast({ label: useResumeStore.getState().saveStatus === "error" ? "简历保存失败，请稍后重试" : "简历已保存" });
  };

  const exportPdf = () => {
    if (!editor || !activeResumeId || pdfExportPending) return;
    pdfExportAbortRef.current?.abort();
    const controller = new AbortController();
    pdfExportAbortRef.current = controller;
    setPdfExportPending(true);
    setToast({ label: "正在生成 PDF…" });
    void exportResumePdf({
      resumeId: activeResumeId,
      title,
      saveCurrentResume,
      signal: controller.signal,
      getSnapshot: () => {
        const state = useResumeStore.getState();
        return {
          activeResumeId: state.activeResumeId,
          lockVersion: state.lockVersion,
          saveStatus: state.saveStatus,
        };
      },
    })
      .then(() => setToast({ label: "PDF 已下载" }))
      .catch((error: unknown) => {
        if (!isResumePdfExportCancelled(error)) {
          setToast({ label: resumePdfExportErrorMessage(error) });
        }
      })
      .finally(() => {
        if (pdfExportAbortRef.current === controller) {
          pdfExportAbortRef.current = null;
          setPdfExportPending(false);
        }
      });
  };

  const editableSemanticSections = data.semantic_sections.filter(
    (section) => section.content_key === "custom_sections"
      && section.semantic_kind !== "basics"
      && section.custom_section_id !== "custom_section_editor",
  );
  const classifiableSections = editableSemanticSections.filter(
    (section) => section.semantic_kind === "custom" && section.semantic_source !== "user",
  );

  const classifySemanticSections = async () => {
    if (!activeResumeId || semanticClassificationPending || classifiableSections.length === 0) return;
    setSemanticClassificationPending(true);
    try {
      await saveCurrentResume();
      const latestState = useResumeStore.getState();
      if (latestState.saveStatus === "error") {
        throw new Error("RESUME_SAVE_FAILED");
      }
      const contentHash = await resumeDocumentContentHash(latestState.data);
      const result = await api.classifyResumeSemantics(activeResumeId, {
        content_hash: contentHash,
        section_ids: classifiableSections.map((section) => section.id),
      });
      let applied = 0;
      for (const suggestion of result.suggestions) {
        if (suggestion.confidence < 0.8) continue;
        setSectionSemanticKind(
          suggestion.section_id,
          suggestion.semantic_kind,
          "model",
          suggestion.confidence,
        );
        applied += 1;
      }
      setToast({
        label: applied > 0
          ? `已识别 ${applied} 个章节，低置信度结果保留为自定义`
          : "未发现可自动确认的章节，请手动选择类型",
      });
    } catch (error) {
      const label = error instanceof ApiRequestError
        && error.message === "RESUME_SEMANTIC_CLASSIFICATION_STALE"
        ? "正文已变化，请保存或刷新后重试识别"
        : "章节识别暂不可用，仍可手动选择类型";
      setToast({ label });
    } finally {
      setSemanticClassificationPending(false);
    }
  };

  const saveNamedVersion = async () => {
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
    if (useResumeStore.getState().saveStatus === "error") {
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
    pdfExportAbortRef.current?.abort();
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

  const prepareAgentProposalConfirmation = async () => {
    await saveCurrentResume();
    if (useResumeStore.getState().error) {
      setToast({ label: "当前草稿保存失败，提案没有应用" });
      return false;
    }
    return true;
  };

  const prepareAgentRun = async () => {
    await saveCurrentResume();
    if (useResumeStore.getState().error) {
      setToast({ label: "当前草稿保存失败，智能助手没有读取所选内容" });
      return false;
    }
    return true;
  };

  const refreshAppliedAgentProposal = async () => {
    if (!activeResumeId || !editor) return;
    await loadResume(activeResumeId);
    editor.commands.setContent(useResumeStore.getState().editorContent);
    setToast({ label: "智能修改已应用，并保存为可恢复版本" });
  };

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
            <WorkbenchTitleInput value={title} onChange={setTitle} disabled={versionOperationPending} />
            <WorkbenchSaveStatus dirty={dirty} saveStatus={saveStatus} />
          </div>
          <div className="workbench-header-actions">
            <div className="workbench-header-tool-group" role="group" aria-label="编辑面板">
              <ResumeCompletenessAction
                score={completeness.score}
                panelOpen={drawerMode === "quality"}
                onToggle={() => setDrawerMode((mode) => mode === "quality" ? null : "quality")}
              />
              <WorkbenchDesignAction
                panelOpen={drawerMode === "settings" || drawerMode === "history"}
                onToggle={() => setDrawerMode((mode) => mode === "settings" ? null : "settings")}
              />
              <ResumeTemplateSwitcher
                currentTemplateKey={style.template_key}
                disabled={versionOperationPending || saveStatus === "saving"}
                onApply={async (template) => {
                  if (!editor) return;
                  try {
                    await applyTemplate(template.id, editor.getJSON());
                    editor.commands.setContent(useResumeStore.getState().editorContent, false);
                    setToast({ label: `已切换为“${template.name}”，内容已按新模板重新排版` });
                  } catch {
                    setToast({ label: "模板切换失败，当前简历未被替换" });
                    throw new Error("TEMPLATE_APPLY_FAILED");
                  }
                }}
              />
            </div>
            <div className="workbench-output-actions" role="group" aria-label="保存与导出">
              <ExportPdfAction
                pending={pdfExportPending}
                onExport={exportPdf}
              />
              <SaveResumeAction
                pending={saveStatus === "saving" || versionOperationPending || versionNameSubmitting}
                onSave={() => { void saveResume(); }}
              />
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
          <StableSelectionToolbarBubble editor={editor}>
            <SelectionFormattingToolbar
              editor={editor}
              onAgentAction={(instruction, selectionContext) => {
                setAgentDraft({ id: Date.now(), instruction, selectionContext });
                setDrawerMode("agent");
              }}
            />
          </StableSelectionToolbarBubble>
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

        <main
          className={workbenchCanvasClassName(drawerMode)}
          style={{ "--agent-drawer-width": `${agentDrawerWidth}px` } as React.CSSProperties}
        >
          <div
            ref={paperScrollRef}
            className={`workbench-paper-scroll${pageArrangement === "horizontal" && !settings.smartOnePage ? " pages-horizontal" : ""}`}
            style={{ "--workbench-preview-scale": renderedPreviewScale } as React.CSSProperties}
          >
            <div className={`workbench-document-stack${pageArrangement === "horizontal" && !settings.smartOnePage ? " pages-horizontal" : ""}`}>
              <article className={`resume-paper theme-${settings.theme}${settings.smartOnePage ? " smart-one-page" : ""}${pageArrangement === "horizontal" && !settings.smartOnePage ? " pages-horizontal" : ""}`} style={resumeStyle} aria-label="可编辑简历页面">
                <EditorContent editor={editor} />
              </article>
            </div>
          </div>

          {activeResumeId && (
            <AgentFloatingEntry
              open={drawerMode === "agent"}
              onToggle={() => setDrawerMode((mode) => mode === "agent" ? null : "agent")}
            />
          )}

          <AnimatePresence initial={false}>
            {drawerMode && (
              <motion.aside
                id="workbench-side-panel"
                className={`workbench-drawer${drawerMode === "agent" ? " is-agent" : ""}`}
                role="region"
                aria-label={drawerMode === "agent" || drawerMode === "quality" ? undefined : "简历编辑面板"}
                aria-labelledby={drawerMode === "agent" ? "workbench-agent-title" : drawerMode === "quality" ? "workbench-quality-title" : undefined}
                initial={{ x: drawerMode === "agent" ? 390 : 392 }}
                animate={{ x: 0 }}
                exit={{ x: drawerMode === "agent" ? 390 : 392 }}
                transition={{ type: "spring", bounce: 0, duration: 0.26 }}
              >
                {(drawerMode === "settings" || drawerMode === "history") && (
                  <WorkbenchPanelSwitcher
                    activePanel={drawerMode}
                    onSettings={() => setDrawerMode("settings")}
                    onHistory={() => setDrawerMode("history")}
                    onClose={() => setDrawerMode(null)}
                  />
                )}
                {drawerMode === "settings" ? (
                  <div
                    id="workbench-settings-panel"
                    className="workbench-settings"
                    role="tabpanel"
                    aria-labelledby="workbench-settings-tab"
                  >
                    <WorkbenchSettingsSection title="页面排列" description="选择多页简历在编辑区中的浏览方式。">
                      <PageArrangementControl
                        value={pageArrangement}
                        onChange={changePageArrangement}
                        smartOnePage={settings.smartOnePage}
                        onSmartOnePageChange={(smartOnePage) => updateSettings({ smartOnePage })}
                        disabled={versionOperationPending}
                        disabledReason="版本操作完成后可调整页面布局"
                      />
                    </WorkbenchSettingsSection>

                    <WorkbenchSettingsSection title="页边距" description="分别调整上下和左右留白，单位为毫米。">
                      <div className="workbench-margin-layout">
                        <div className="workbench-margin-controls">
                          <SettingsStepper label="上下边距" unit="mm" value={settings.verticalPageMargin} min={WORKBENCH_VERTICAL_PAGE_MARGIN_MIN_MM} max={30} step={2} onChange={(verticalPageMargin) => updateSettings({ verticalPageMargin })} disabled={versionOperationPending} />
                          <SettingsStepper label="左右边距" unit="mm" value={settings.pageMargin} min={10} max={30} step={2} onChange={(pageMargin) => updateSettings({ pageMargin })} disabled={versionOperationPending} />
                        </div>
                        <div className="workbench-margin-preview" aria-label={`当前上下边距 ${settings.verticalPageMargin} 毫米，左右边距 ${settings.pageMargin} 毫米`}>
                          <span className="workbench-margin-preview-page">
                            <Rows3 aria-hidden="true" />
                          </span>
                          <small>页面预览</small>
                        </div>
                      </div>
                    </WorkbenchSettingsSection>

                    <WorkbenchSettingsSection title="排版" description="统一调整简历正文的字体、字号和行距。" icon={<Type aria-hidden="true" size={15} />}>
                      <div className="workbench-typography-settings">
                        <FontPreviewSelect value={settings.fontFamily} onChange={(fontFamily) => updateSettings({ fontFamily })} disabled={versionOperationPending} />
                        <SettingsStepper label="正文字号" unit="pt" value={settings.fontSize} min={8} max={16} step={0.5} onChange={(fontSize) => updateSettings({ fontSize })} disabled={versionOperationPending} />
                        <SettingsStepper label="正文行距" unit="" value={settings.lineHeight} min={1.1} max={1.8} step={0.05} onChange={(lineHeight) => updateSettings({ lineHeight })} disabled={versionOperationPending} />
                      </div>
                    </WorkbenchSettingsSection>

                    {editableSemanticSections.length > 0 && (
                      <WorkbenchSettingsSection
                        title="章节类型"
                        description="标题与章节含义分别保存；可手动确认，或结合正文和上下文识别一次。"
                        icon={<Sparkles aria-hidden="true" size={15} />}
                      >
                        <div className="workbench-semantic-settings">
                          {editableSemanticSections.map((section) => {
                            const displayTitle = semanticSectionDisplayTitle(section.display_title);
                            return (
                              <div className="workbench-semantic-row" key={section.id}>
                                <span title={displayTitle}>{displayTitle}</span>
                                <Select
                                  value={section.semantic_kind}
                                  disabled={versionOperationPending || semanticClassificationPending}
                                  onValueChange={(semanticKind) => setSectionSemanticKind(
                                    section.id,
                                    semanticKind as keyof typeof SEMANTIC_KIND_LABELS,
                                  )}
                                >
                                  <SelectTrigger aria-label={`${displayTitle}章节类型`}>
                                    {SEMANTIC_KIND_LABELS[section.semantic_kind as keyof typeof SEMANTIC_KIND_LABELS]}
                                  </SelectTrigger>
                                  <SelectContent data-ui-theme="light" position="popper">
                                    {Object.entries(SEMANTIC_KIND_LABELS).filter(([value]) => value !== "basics").map(([value, label]) => (
                                      <SelectItem key={value} value={value}>{label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            );
                          })}
                          {classifiableSections.length > 0 && (
                            <Button
                              type="button"
                              variant="outline"
                              disabled={versionOperationPending || semanticClassificationPending}
                              onClick={() => void classifySemanticSections()}
                            >
                              {semanticClassificationPending
                                ? <LoaderCircle aria-hidden="true" className="spin" size={15} />
                                : <Sparkles aria-hidden="true" size={15} />}
                              识别未分类章节
                            </Button>
                          )}
                        </div>
                      </WorkbenchSettingsSection>
                    )}
                  </div>
                ) : drawerMode === "history" ? (
                  <div
                    id="workbench-history-panel"
                    className="workbench-versions"
                    role="tabpanel"
                    aria-labelledby="workbench-history-tab"
                  >
                    <div className="workbench-version-create">
                      <SaveVersionAction
                        pending={saveStatus === "saving" || versionOperationPending || versionNameSubmitting}
                        onSave={openVersionNameDialog}
                      />
                    </div>
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
                ) : drawerMode === "quality" ? (
                  <ResumeCompletenessPanel
                    result={completeness}
                    onClose={() => setDrawerMode(null)}
                  />
                ) : activeResumeId ? (
                  <>
                    <div
                      className="agent-drawer-resize-handle"
                      role="separator"
                      tabIndex={0}
                      aria-label="调整智能助手宽度"
                      aria-orientation="vertical"
                      aria-valuemin={AGENT_DRAWER_MIN_WIDTH}
                      aria-valuemax={clampAgentDrawerWidth(AGENT_DRAWER_MAX_WIDTH, viewportWidth)}
                      aria-valuenow={agentDrawerWidth}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || event.isPrimary === false || window.innerWidth <= 720) return;
                        agentDrawerResizeRef.current = {
                          pointerId: event.pointerId,
                          clientX: event.clientX,
                          width: agentDrawerWidth,
                          currentWidth: agentDrawerWidth,
                        };
                        event.currentTarget.setPointerCapture?.(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const resize = agentDrawerResizeRef.current;
                        if (!resize || resize.pointerId !== event.pointerId) return;
                        event.preventDefault();
                        resize.currentWidth = clampAgentDrawerWidth(
                          resize.width + resize.clientX - event.clientX,
                          window.innerWidth,
                        );
                        setAgentDrawerWidth(resize.currentWidth);
                      }}
                      onPointerUp={(event) => {
                        const resize = agentDrawerResizeRef.current;
                        if (!resize || resize.pointerId !== event.pointerId) return;
                        persistAgentDrawerWidth(resize.currentWidth);
                        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                        agentDrawerResizeRef.current = null;
                      }}
                      onPointerCancel={() => { agentDrawerResizeRef.current = null; }}
                      onKeyDown={(event) => {
                        let nextWidth: number | null = null;
                        const step = event.shiftKey ? 32 : 16;
                        if (event.key === "ArrowLeft") nextWidth = agentDrawerWidth + step;
                        if (event.key === "ArrowRight") nextWidth = agentDrawerWidth - step;
                        if (event.key === "Home") nextWidth = AGENT_DRAWER_MIN_WIDTH;
                        if (event.key === "End") nextWidth = AGENT_DRAWER_MAX_WIDTH;
                        if (nextWidth === null) return;
                        event.preventDefault();
                        persistAgentDrawerWidth(nextWidth);
                      }}
                    />
                    <AgentPanel
                      key={activeResumeId}
                      resumeId={activeResumeId}
                      currentData={data}
                      currentStyle={style}
                      userAvatarUrl={user?.avatar_url}
                      userDisplayName={user?.nickname || user?.email || "用户"}
                      onBeforeRun={prepareAgentRun}
                      onBeforeConfirm={prepareAgentProposalConfirmation}
                      onApplied={refreshAppliedAgentProposal}
                      onClose={() => setDrawerMode(null)}
                      draft={agentDraft}
                    />
                  </>
                ) : null}
              </motion.aside>
            )}
          </AnimatePresence>
        </main>

        <AnimatePresence>
          {zoomFeedback && (
            <motion.div
              key={zoomFeedback.sequence}
              className="workbench-zoom-feedback-wrap"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
            >
              <ZoomFeedback scale={zoomFeedback.scale} />
            </motion.div>
          )}
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
            <form className="version-name-form" onSubmit={(event) => { event.preventDefault(); void saveNamedVersion(); }}>
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
