import { t, useLocale, getLocale } from "@/i18n";
import { MotionPresence } from "@/components/ui/motion";
import { type Editor, type JSONContent } from "@tiptap/core";
import { BubbleMenu, EditorContent, useEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Pencil, Rows2, Columns2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Instance as TippyInstance } from "tippy.js";
import { api, ApiRequestError, type AgentSelectionContext, type ResumeTemplate } from "../../api/client";
import { resumeImageContractErrorMessage } from "./resumeImageLimits";
import { IconButton } from "@/components/ui";
import { useResumeStore, type ResumeSettings } from "../../store/resumeStore";
import { resumeEditorExtensions } from "./editorExtensions";
import { SelectionFormattingToolbar, WorkbenchHistoryActions } from "./WorkbenchToolbar";
import {
  createSelectionBubbleAnchor,
  refreshSelectionBubblePosition,
  selectionBubbleContainer,
  selectionEndAnchorRect,
  shouldShowSelectionAgentBubble,
} from "./selectionBubbleAnchor";
import { getTwoPageFitScale, getWheelZoomScale, handleWheelZoom } from "./workbenchZoom";
import { navigateTo } from "../../routing";
import {
  LineInsertMenuExtension,
  SlashCommandMenu,
  slashCommandQuery,
  type CommandMenuState,
} from "./slashCommand";
import { evaluateResumeCompleteness, type ResumeCompletenessResult } from "./resumeCompleteness";
import { ResumeCompletenessPanel } from "./ResumeCompletenessPanel";
import { WorkbenchTemplatePanel } from "./WorkbenchTemplatePanel";
import { WorkbenchOutlinePanel } from "./WorkbenchOutlinePanel";
import { WorkbenchTypePanel } from "./WorkbenchTypePanel";
import { WorkbenchGauge } from "./WorkbenchGauge";
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
import {
  normalizeResumeAccentColor,
  resumePresentationAccentColor,
  resumePresentationTemplateKey,
  type ResumePresentationRead,
} from "../../api/resumeContract";
import { liveResumePageMargins } from "../preview/resumePageMargins";
import { V3Shell } from "../../v3/Shell";
import { Icon, type V3IconName } from "../../v3/Icon";
import { ConfirmDialog, Menu, Toast } from "../../v3/primitives";
import { Centered, MiniResume, Badge } from "../../v3/art";
import "./workbench-v3.css";

// 兼容旧导出：排版相关的步进 / 字体组件移到 WorkbenchTypePanel
export { FontPreviewSelect, steppedSettingValue, WORKBENCH_VERTICAL_PAGE_MARGIN_MIN_MM, SettingsSlider } from "./WorkbenchTypePanel";

// 右侧工具卡片的四个面板（Figma 02.2a–02.2d），同一时间只开一个，默认全部收起。
// AI 助手不在 V3 设计里：入口已去掉，AgentPanel 源码保留给首页模块使用。
export type DrawerMode = "outline" | "template" | "type" | "quality" | null;

const WORKBENCH_TITLE_CHARACTER_LIMIT = 30;

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

// 标题输入框：宽度跟随文字（Figma 标题 14.5 Medium，居中在顶栏）
export function WorkbenchTitleInput({ value, disabled, onChange }: WorkbenchTitleInputProps) {
  useLocale();
  const truncated = truncateWorkbenchTitle(value) !== value;

  return (
    <span className="wb3-title-wrap" data-value={truncateWorkbenchTitle(value) || " "}>
      <input
        autoComplete="off"
        className="workbench-title"
        name="resume-title"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={t("简历标题")}
        disabled={disabled}
        title={truncated ? value : undefined}
      />
    </span>
  );
}

export function workbenchCanvasClassName(drawerMode: DrawerMode) {
  return `workbench-canvas${drawerMode ? " has-drawer" : ""}`;
}

export function resumeWorkbenchStyle(
  settings: Pick<ResumeSettings, "fontFamily" | "fontSize" | "lineHeight" | "pageMargin" | "verticalPageMargin">,
  accentColor: unknown,
  style?: ResumePresentationRead,
) {
  const margins = liveResumePageMargins(settings, style);
  return {
    "--resume-font-family": settings.fontFamily,
    "--resume-font-size": `${settings.fontSize}pt`,
    "--resume-line-height": settings.lineHeight,
    "--resume-page-margin-x": `${settings.pageMargin}mm`,
    "--resume-page-margin-y": `${settings.verticalPageMargin}mm`,
    "--resume-page-margin-top": `${margins.top}mm`,
    "--resume-page-margin-right": `${margins.right}mm`,
    "--resume-page-margin-bottom": `${margins.bottom}mm`,
    "--resume-page-margin-left": `${margins.left}mm`,
    "--preview-accent": normalizeResumeAccentColor(accentColor),
  } as React.CSSProperties;
}

// ⋯ 更多操作：只保留删除简历（导出 PDF 是顶栏主按钮，完整度走分数胶囊）
export function WorkbenchMoreMenu({ onDelete }: { onDelete: () => void }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`wb3-more${open ? " is-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("更多操作")}
        title={t("更多操作")}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" size={16} />
      </button>
      <Menu
        anchorRef={anchorRef}
        open={open}
        onClose={close}
        placement="bottom-end"
        width={160}
        label={t("更多操作")}
        items={[{ label: t("删除简历"), icon: "trash", danger: true, onSelect: onDelete }]}
      />
    </>
  );
}

// 顶栏完整度胶囊：小号仪表盘 + 分数 + 等级，点开 02.2d 简历检查
export function WorkbenchScorePill({ result, active, onClick }: { result: ResumeCompletenessResult; active: boolean; onClick: () => void }) {
  useLocale();
  return (
    <button
      type="button"
      className={`wb3-score${active ? " is-active" : ""}`}
      aria-label={t("简历完整度 {value0} 分，{value1}，打开简历检查", { value0: result.score, value1: result.level })}
      aria-pressed={active}
      onClick={onClick}
    >
      <WorkbenchGauge score={result.score} mini />
      <strong>{result.score}</strong>
      <span>{result.level}</span>
    </button>
  );
}

type RailItem = { mode: Exclude<DrawerMode, null>; icon: V3IconName; label: string };
const RAIL_ITEMS: RailItem[] = [
  { mode: "outline", icon: "outline", get label() { return t("大纲"); } },
  { mode: "template", icon: "layout", get label() { return t("模板"); } },
  { mode: "type", icon: "typeA", get label() { return t("排版"); } },
  { mode: "quality", icon: "ccheck", get label() { return t("检查"); } },
];

// 右侧竖向工具卡片（Figma lib12 · ewRail）：56 宽，每项 48×52，选中灰底；「检查」右上角橙色角标 = 待完善项数
export function WorkbenchToolRail({
  mode,
  pendingChecks,
  templateDisabled,
  onToggle,
}: {
  mode: DrawerMode;
  pendingChecks: number;
  templateDisabled?: boolean;
  onToggle: (mode: Exclude<DrawerMode, null>) => void;
}) {
  useLocale();
  return (
    <nav className="wb3-rail" aria-label={t("编辑工具")}>
      {RAIL_ITEMS.map((item) => {
        const active = mode === item.mode;
        const label = item.mode === "template" ? t("简历模板") : item.mode === "quality" ? t("简历检查") : item.label;
        return (
          <button
            key={item.mode}
            type="button"
            className={`wb3-rail-item${active ? " is-active" : ""}`}
            aria-label={label}
            aria-controls="workbench-side-panel"
            aria-expanded={active}
            aria-pressed={active}
            disabled={item.mode === "template" && templateDisabled}
            onClick={() => onToggle(item.mode)}
          >
            <Icon name={item.icon} size={18} />
            <span>{item.label}</span>
            {item.mode === "quality" && pendingChecks > 0 ? <em className="wb3-rail-badge" aria-hidden="true">{pendingChecks}</em> : null}
          </button>
        );
      })}
    </nav>
  );
}

// 右侧页面设置：保留页面排列与智能一页的既有行为
export function WorkbenchPageBar({
  arrangement,
  smartOnePage,
  disabled,
  onArrangementChange,
  onSmartOnePageChange,
}: {
  arrangement: PageArrangement;
  smartOnePage: boolean;
  disabled?: boolean;
  onArrangementChange: (value: PageArrangement) => void;
  onSmartOnePageChange: (enabled: boolean) => void;
}) {
  useLocale();
  return (
    <div className="wb3-pagebar" role="toolbar" aria-label={t("页面设置")}>
      <div className="wb3-type-section">
        <strong>{t("页面排列")}</strong>
        <small>{t("选择多页简历在编辑区中的浏览方式。")}</small>
      </div>
      <div className="wb3-arrangement-options" role="group" aria-label={t("页面排列")}>
        {(["vertical", "horizontal"] as const).map((value) => (
          <button key={value} type="button" aria-label={value === "vertical" ? t("上下排列") : t("左右排列")}
            aria-pressed={!smartOnePage && arrangement === value} disabled={disabled}
            onClick={() => {
              if (smartOnePage) onSmartOnePageChange(false);
              onArrangementChange(value);
            }}>
            <span className="wb3-arrangement-icon">{value === "vertical" ? <Rows2 size={24} /> : <Columns2 size={24} />}</span>
            <span>{value === "vertical" ? t("上下排列") : t("左右排列")}</span>
          </button>
        ))}
        <button type="button" role="switch" aria-checked={smartOnePage} aria-label={t("智能一页")}
          disabled={disabled} onClick={() => onSmartOnePageChange(!smartOnePage)}>
          <span className="wb3-arrangement-icon"><Sparkles size={24} /></span>
          <span>{t("智能一页")}</span>
        </button>
      </div>
      <p className="wb3-arrangement-note">{t("排列只影响编辑时的浏览方向。")}</p>
    </div>
  );
}

// 保存状态（Figma 509:1187）：已保存 绿色勾 / 编辑中 橙点 / 保存中… 转圈 / 保存失败 · 请重试 红点，不显示时间
type WorkbenchSaveStatusProps = {
  saveStatus: "idle" | "saving" | "saved" | "error";
  dirty: boolean;
  error?: string | null;
};

export function saveStatusKind({ saveStatus, dirty }: Pick<WorkbenchSaveStatusProps, "saveStatus" | "dirty">) {
  return saveStatus === "saving" ? "saving" : saveStatus === "error" ? "error" : dirty ? "editing" : "saved";
}

export function WorkbenchSaveStatus({ saveStatus, dirty, error }: WorkbenchSaveStatusProps) {
  useLocale();
  const kind = saveStatusKind({ saveStatus, dirty });
  const imageError = resumeImageContractErrorMessage(error);
  const conflict = error === "RESUME_EDIT_CONFLICT";
  const label = kind === "saving"
    ? t("保存中…")
    : kind === "error"
      ? t("保存失败 · {value0}", { value0: imageError ?? (conflict ? t("简历已在其他地方修改") : t("请重试")) })
      : kind === "editing"
        ? t("编辑中")
        : t("已保存");

  return (
    <span aria-live="polite" className={`workbench-save-status ${kind}`} role="status">
      {kind === "saving"
        ? <Icon name="refresh" size={13} className="workbench-status-spinner" />
        : kind === "saved"
          ? <Icon name="ccheck" size={13} />
          : <i aria-hidden="true" />}
      {label}
    </span>
  );
}

export function ImportWarningBanner({ warnings, onDismiss }: { warnings: string[]; onDismiss: () => void }) {
  useLocale();
  return (
    <div className="workbench-import-warning" role="status">
      <Icon name="alert" size={16} />
      <div>
        <strong>{t("请检查导入结果")}</strong>
        <p>{warnings.map(importWarningMessage).join("；")}</p>
      </div>
      <button type="button" aria-label={t("关闭导入质量提示")} onClick={onDismiss}>
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}

export function ZoomFeedback({ scale }: { scale: number }) {
  useLocale();
  return <div className="workbench-zoom-feedback" role="status" aria-live="polite">{Math.round(scale * 100)}%</div>;
}

// 10.3 局部状态 · 简历编辑器打开失败（Figma 494:2）见 EditorOpenError.tsx

type ToastState = { kind: "info" | "success" | "warning" | "error"; label: string; retry?: boolean } | null;
export type { PageArrangement } from "./pageArrangementTransition";

const EMPTY_IMPORT_WARNINGS: string[] = [];
const A4_WIDTH_IN_CSS_PIXELS = (210 / 25.4) * 96;
// Figma 02.2: editor 100% displays a 560px page; print geometry remains A4.
const EDITOR_PAGE_BASE_SCALE = 560 / A4_WIDTH_IN_CSS_PIXELS;
const A4_HEIGHT_IN_CSS_PIXELS = (297 / 25.4) * 96;
const PAGE_ARRANGEMENT_STORAGE_KEY = "linkresume.workbench.page-arrangement";

function currentSelectionRect(editor: Editor) {
  const { ranges } = editor.state.selection;
  const to = Math.max(...ranges.map((range) => range.$to.pos));
  return selectionEndAnchorRect(editor.view.coordsAtPos(to, -1));
}

const supportsCssZoom = typeof CSS !== "undefined"
  && typeof CSS.supports === "function"
  && CSS.supports("zoom", "1");

function StableSelectionToolbarBubble({
  editor,
  scale,
  children,
}: {
  editor: Editor;
  scale: number;
  children: ReactNode;
}) {
  useLocale();
  const anchorRef = useRef<ReturnType<typeof createSelectionBubbleAnchor> | null>(null);
  const tippyRef = useRef<TippyInstance | null>(null);
  if (!anchorRef.current) anchorRef.current = createSelectionBubbleAnchor();
  const anchor = anchorRef.current;
  // 画布缩小时工具栏跟着缩小；放大到 100% 以上时保持基准尺寸，避免遮挡正文。
  const bubbleScale = Math.min(scale, 1);

  useEffect(() => {
    const scrollArea = editor.view.dom.closest(".workbench-paper-scroll");
    const refresh = () => {
      refreshSelectionBubblePosition(
        anchor,
        () => currentSelectionRect(editor),
        () => { void tippyRef.current?.popperInstance?.update(); },
      );
    };
    tippyRef.current?.setProps({ offset: [0, 8 * bubbleScale] });
    scrollArea?.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh, { passive: true });
    refresh();
    return () => {
      scrollArea?.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
    // 依赖未裁剪的 scale：放大到 100% 以上时弹窗尺寸不变，但选区位置已经移动，
    // 仍然必须重新读取锚点，否则弹窗会停在缩放前的位置。
  }, [anchor, editor, scale, bubbleScale]);

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{
        // Keep Tippy outside the zoomed paper so viewport coordinates are not
        // scaled twice, but inside React's root so delegated button events work.
        appendTo: () => selectionBubbleContainer(editor.view.dom, document.body),
        duration: 150,
        maxWidth: "none",
        placement: "bottom-start",
        offset: [0, 8 * bubbleScale],
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
          () => selectionEndAnchorRect(view.coordsAtPos(to, -1)),
        );
        return visible;
      }}
    >
      <div
        className={`selection-toolbar-bubble-scale${supportsCssZoom ? "" : " is-scale-fallback"}`}
        style={{ "--selection-toolbar-scale": bubbleScale } as React.CSSProperties}
      >
        {children}
      </div>
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
  if (!normalized) return t("请填写版本名称");
  if (normalized.length > MAX_VERSION_NAME_LENGTH) return t("版本名称不能超过 {value0} 个字符", { value0: MAX_VERSION_NAME_LENGTH });
  return null;
}

function versionTime(value: string) {
  return new Date(value).toLocaleString(getLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function versionOperationErrorMessage(error: unknown, operation: "create" | "restore") {
  if (error instanceof ApiRequestError) {
    const imageError = resumeImageContractErrorMessage(error.message);
    if (imageError) return imageError;
  }
  if (operation !== "create" || !(error instanceof ApiRequestError) || error.message !== "RESUME_VERSION_LIMIT_REACHED") {
    return null;
  }
  return t("当前内容已保存，但版本数量已达上限。请删除一个旧版本后再保存新版本。");
}

export function versionRenameErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.message === "INVALID_RESUME_VERSION_NAME") return t("版本名称不能为空且不能超过 80 个字符。");
    if (error.message === "RESUME_VERSION_NOT_FOUND") return t("该版本不存在，请刷新后重试。");
  }
  return t("保存版本名称失败，请稍后重试。");
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
  useLocale();
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
      setValidationError(t("请填写版本名称"));
      return;
    }
    if (nextName.length > 80) {
      setValidationError(t("版本名称不能超过 80 个字符"));
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
            aria-label={t("版本 {value0} 名称", { value0: versionNo })}
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
            label={t("重命名版本 {value0}", { value0: versionNo })}
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
  // 编辑器内部复制/剪切产生的 HTML 带 data-pm-slice 标记与 resume-* 节点结构，
  // 原样交给 schema 解析才能保住分栏、图片等格式；外部来源的 HTML 仍拍平为纯段落。
  if (html.includes("data-pm-slice")) return html;
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

type ResumeWorkbenchProps = {
  /** 兼容 AssistantPage 的内嵌用法：不渲染 V3 外框与顶栏 */
  embedded?: boolean;
  externalRefreshVersion?: number;
  onClose?: () => void;
  onAgentSelectionChange?: (context: AgentSelectionContext | null) => void;
};

const AGENT_TARGET_ANCHOR_ROLES = new Set([
  "entry-field", "contact", "row-block", "list-item",
  "section-block", "entry-block", "block",
]);

async function selectionContextFromEditor(editor: Editor): Promise<AgentSelectionContext | null> {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const selectedText = editor.state.doc.textBetween(from, to, "\n", "\ufffc");
  if (!selectedText.trim()) return null;
  const blockIds: string[] = [];
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) return true;
    const anchors: Array<{ blockId: string; role: string }> = [];
    node.forEach((child) => {
      if (child.type.name !== "resumeBlockAnchor") return;
      if (typeof child.attrs.blockId !== "string" || typeof child.attrs.role !== "string") return;
      anchors.push({ blockId: child.attrs.blockId, role: child.attrs.role });
    });
    const directTargets = anchors.filter((anchor) => AGENT_TARGET_ANCHOR_ROLES.has(anchor.role));
    const structural = anchors.find((anchor) => (
      (anchors.some((item) => item.role === "section-title") && anchor.role === "section")
      || (anchors.some((item) => item.role === "identity-name") && anchor.role === "identity")
      || (anchors.some((item) => item.role === "entry-field") && anchor.role === "entry")
    ));
    (structural ? [structural] : directTargets.length ? directTargets : anchors.slice(0, 1))
      .forEach((anchor) => blockIds.push(anchor.blockId));
    return false;
  });
  const uniqueBlockIds = [...new Set(blockIds)];
  if (!uniqueBlockIds.length) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(selectedText));
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return {
    block_ids: uniqueBlockIds,
    from,
    to,
    selected_text: selectedText,
    selected_text_hash: `sha256:${hash}`,
  };
}

export function ResumeWorkbench({
  embedded = false,
  externalRefreshVersion = 0,
  onClose,
  onAgentSelectionChange,
}: ResumeWorkbenchProps = {}) {
  useLocale();
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
  const updateSettings = useResumeStore((state) => state.updateSettings);
  const applyTemplate = useResumeStore((state) => state.applyTemplate);
  const previewScale = useResumeStore((state) => state.previewScale);
  const setPreviewScale = useResumeStore((state) => state.setPreviewScale);
  const saveStatus = useResumeStore((state) => state.saveStatus);
  const saveError = useResumeStore((state) => state.error);
  const dirty = useResumeStore((state) => state.dirty);
  const saveCurrentResume = useResumeStore((state) => state.saveCurrentResume);
  const versionOperationPending = useResumeStore((state) => state.versionOperationPending
    || Boolean(state.proposalApplyingResumeId && state.proposalApplyingResumeId === state.activeResumeId));
  const proposalContentRevision = useResumeStore((state) => state.proposalContentRevision);
  const goHome = useResumeStore((state) => state.goHome);
  const deleteStoredResume = useResumeStore((state) => state.deleteResume);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [pdfExportPending, setPdfExportPending] = useState(false);
  const [commandMenu, setCommandMenu] = useState<CommandMenuState | null>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(() => window.innerWidth);
  const [horizontalScaleOverride, setHorizontalScaleOverride] = useState<number | null>(null);
  const [zoomFeedback, setZoomFeedback] = useState<{ scale: number; sequence: number } | null>(null);
  const [saveErrorNoticeOpen, setSaveErrorNoticeOpen] = useState(false);
  const [pageArrangement, setPageArrangement] = useState<PageArrangement>(() => {
    try {
      return window.localStorage.getItem(PAGE_ARRANGEMENT_STORAGE_KEY) === "horizontal" ? "horizontal" : "vertical";
    } catch {
      return "vertical";
    }
  });
  const paperScrollRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLElement>(null);
  const arrangementAnimationRef = useRef<Animation | null>(null);
  const pdfExportAbortRef = useRef<AbortController | null>(null);
  const lastPageAnchorRef = useRef<ReturnType<typeof capturePageViewportAnchor> | null>(null);
  const arrangementLayoutRunRef = useRef(0);
  const agentSelectionCallbackRef = useRef(onAgentSelectionChange);
  const agentSelectionRevisionRef = useRef(0);
  agentSelectionCallbackRef.current = onAgentSelectionChange;
  const completeness = useMemo(() => evaluateResumeCompleteness(markdown), [markdown]);
  const pendingChecks = completeness.checks.filter((item) => item.status !== "passed").length;

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

  const displayBaseScale = embedded ? 1 : EDITOR_PAGE_BASE_SCALE;
  const responsiveFitScale = viewportWidth <= 720
    ? Math.min(displayBaseScale, Math.max(0.36, (viewportWidth - 32) / A4_WIDTH_IN_CSS_PIXELS))
    : displayBaseScale;
  const horizontalPadding = viewportWidth <= 720 ? 32 : viewportWidth <= 980 ? 48 : 96;
  const horizontalAutoFitScale = getTwoPageFitScale(workspaceWidth, horizontalPadding);
  const horizontalMode = pageArrangement === "horizontal" && !settings.smartOnePage;
  const renderedPreviewScale = horizontalMode
    ? horizontalScaleOverride ?? horizontalAutoFitScale
    : previewScale * responsiveFitScale;
  const showZoomFeedback = useCallback((scale: number) => {
    setZoomFeedback({ scale, sequence: Date.now() });
  }, []);

  const publishAgentSelection = (current: Editor) => {
    const revision = ++agentSelectionRevisionRef.current;
    if (current.state.selection.empty) {
      agentSelectionCallbackRef.current?.(null);
      return;
    }
    void selectionContextFromEditor(current).then((context) => {
      if (agentSelectionRevisionRef.current === revision) {
        agentSelectionCallbackRef.current?.(context);
      }
    });
  };

  const editor = useEditor({
    // The editor view owns document transactions; surrounding controls subscribe
    // explicitly, so an extra React render per keystroke only destabilizes input.
    shouldRerenderOnTransaction: false,
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
      publishAgentSelection(current);
      const { from, $from } = current.state.selection;
      if (!current.state.selection.empty) {
        setCommandMenu(null);
        return;
      }
      const line = current.state.doc.textBetween($from.start(), from, "\n", "\ufffc");
      const query = slashCommandQuery(line);
      if (query === null) {
        setCommandMenu((menu) => menu?.replaceRange ? null : menu);
        return;
      }
      const slashFrom = from - query.length - 1;
      const coordinates = current.view.coordsAtPos(from);
      setCommandMenu({
        x: Math.max(12, Math.min(coordinates.left, window.innerWidth - 244)),
        y: Math.max(12, Math.min(coordinates.bottom + 6, window.innerHeight - 380)),
        query,
        replaceRange: { from: slashFrom, to: from },
      });
    },
    onSelectionUpdate: ({ editor: current }) => publishAgentSelection(current),
  }, [activeResumeId]);

  useEffect(() => {
    if (!editor || externalRefreshVersion <= 0) return;
    setRestoredEditorContent(editor, useResumeStore.getState().editorContent);
  }, [editor, externalRefreshVersion]);

  useEffect(() => () => {
    agentSelectionRevisionRef.current += 1;
    agentSelectionCallbackRef.current?.(null);
  }, []);

  useEffect(() => {
    if (editor) setWorkbenchEditorEditable(editor, !versionOperationPending);
  }, [editor, versionOperationPending]);

  useEffect(() => {
    if (!editor || !proposalContentRevision) return;
    const state = useResumeStore.getState();
    if (state.activeResumeId === activeResumeId && !state.dirty) {
      editor.commands.setContent(state.editorContent, false);
    }
  }, [editor, activeResumeId, proposalContentRevision]);

  // 保存失败时弹出浮动提示（Figma 509:1187 ④），不离开页面、不丢内容
  useEffect(() => {
    setSaveErrorNoticeOpen(saveStatus === "error");
  }, [saveStatus, saveError]);

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
        const nextScale = getWheelZoomScale(renderedPreviewScale / displayBaseScale, event, { minScale: 0.1 });
        if (nextScale === null) return;
        event.preventDefault();
        setHorizontalScaleOverride(nextScale * displayBaseScale);
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
  }, [displayBaseScale, horizontalMode, previewScale, renderedPreviewScale, setPreviewScale, showZoomFeedback]);

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

  const resumeStyle = useMemo(
    () => resumeWorkbenchStyle(settings, resumePresentationAccentColor(style), style),
    [data, settings, style],
  );

  const applyWorkbenchTemplate = async (template: ResumeTemplate) => {
    if (!editor) return;
    try {
      await applyTemplate(template.id, editor.getJSON());
      editor.commands.setContent(useResumeStore.getState().editorContent, false);
      setToast({ kind: "success", label: t("已切换为“{value0}”，内容已按新模板重新排版", { value0: template.name }) });
    } catch (error) {
      const imageError = error instanceof ApiRequestError
        ? resumeImageContractErrorMessage(error.message)
        : null;
      setToast({ kind: "error", label: imageError ?? t("模板切换失败，当前简历未被替换") });
    }
  };

  const exportPdf = () => {
    if (!editor || !activeResumeId || pdfExportPending) return;
    pdfExportAbortRef.current?.abort();
    const controller = new AbortController();
    pdfExportAbortRef.current = controller;
    setPdfExportPending(true);
    setToast({ kind: "info", label: t("正在生成 PDF…") });
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
          saveError: state.error,
        };
      },
    })
      .then(() => setToast({ kind: "success", label: t("PDF 已下载") }))
      .catch((error: unknown) => {
        if (!isResumePdfExportCancelled(error)) {
          setToast({ kind: "error", label: resumePdfExportErrorMessage(error) });
        }
      })
      .finally(() => {
        if (pdfExportAbortRef.current === controller) {
          pdfExportAbortRef.current = null;
          setPdfExportPending(false);
        }
      });
  };

  const leaveSafely = async () => {
    pdfExportAbortRef.current?.abort();
    if (dirty) {
      await saveCurrentResume();
      const savedState = useResumeStore.getState();
      if (savedState.error) {
        setToast({
          kind: "error",
          label: resumeImageContractErrorMessage(savedState.error) ?? t("保存失败，已留在当前页面，请重试"),
        });
        return;
      }
    }
    if (embedded && onClose) {
      onClose();
      return;
    }
    goHome();
    navigateTo("/resumes");
  };

  const confirmDeleteResume = async () => {
    if (!activeResumeId || deletePending) return;
    setDeletePending(true);
    try {
      await deleteStoredResume(activeResumeId);
    } catch {
      setDeletePending(false);
      setDeleteDialogOpen(false);
      setToast({ kind: "error", label: t("删除简历失败，请稍后重试") });
      return;
    }
    setDeleteDialogOpen(false);
    if (embedded && onClose) {
      onClose();
      return;
    }
    goHome();
    navigateTo("/resumes");
  };

  const retrySave = async () => {
    setSaveErrorNoticeOpen(false);
    await saveCurrentResume();
  };

  const toggleDrawer = (mode: Exclude<DrawerMode, null>) => setDrawerMode((current) => current === mode ? null : mode);

  const importWarnings = activeResumeId
    ? importWarningsByResumeId[activeResumeId] ?? EMPTY_IMPORT_WARNINGS
    : EMPTY_IMPORT_WARNINGS;
  const saveKind = saveStatusKind({ saveStatus, dirty });
  const saveErrorMessage = resumeImageContractErrorMessage(saveError)
    ?? (saveError === "RESUME_EDIT_CONFLICT"
      ? t("这份简历已在其他地方修改，刷新页面后再编辑。")
      : t("已留在当前页面，请重试。"));

  const canvas = (
    <main
      className={workbenchCanvasClassName(embedded ? null : drawerMode)}
    >
      <div
        ref={paperScrollRef}
        className={`workbench-paper-scroll${horizontalMode ? " pages-horizontal" : ""}`}
        style={{ "--workbench-preview-scale": renderedPreviewScale } as React.CSSProperties}
      >
        <div className={`workbench-document-stack${horizontalMode ? " pages-horizontal" : ""}`}>
          <article
            ref={paperRef}
            className={`resume-paper theme-${settings.theme}${settings.smartOnePage ? " smart-one-page" : ""}${horizontalMode ? " pages-horizontal" : ""}`}
            style={resumeStyle}
            aria-label={t("可编辑简历页面")}
          >
            <EditorContent editor={editor} />
          </article>
        </div>
      </div>

      {!embedded && (
        <>
          <WorkbenchToolRail
            mode={drawerMode}
            pendingChecks={pendingChecks}
            templateDisabled={versionOperationPending || saveStatus === "saving"}
            onToggle={toggleDrawer}
          />

          <AnimatePresence initial={false}>
            {drawerMode && (
              <motion.aside
                key="workbench-side-panel"
                id="workbench-side-panel"
                className="workbench-drawer wb3-drawer"
                role="region"
                aria-labelledby={{
                  outline: "workbench-outline-title",
                  template: "workbench-template-title",
                  type: "workbench-type-title",
                  quality: "workbench-quality-title",
                }[drawerMode]}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ type: "spring", bounce: 0, duration: 0.24 }}
              >
                {drawerMode === "outline" && editor ? (
                  <WorkbenchOutlinePanel
                    editor={editor}
                    completeness={completeness}
                    disabled={versionOperationPending}
                    onClose={() => setDrawerMode(null)}
                  />
                ) : drawerMode === "template" ? (
                  <WorkbenchTemplatePanel
                    currentTemplateKey={resumePresentationTemplateKey(style)}
                    disabled={versionOperationPending || saveStatus === "saving"}
                    onApply={applyWorkbenchTemplate}
                    onClose={() => setDrawerMode(null)}
                  />
                ) : drawerMode === "type" ? (
                  <WorkbenchTypePanel
                    pageControls={
                      <WorkbenchPageBar
                        arrangement={pageArrangement}
                        smartOnePage={settings.smartOnePage}
                        disabled={versionOperationPending}
                        onArrangementChange={changePageArrangement}
                        onSmartOnePageChange={(smartOnePage) => updateSettings({ smartOnePage })}
                      />
                    }
                    settings={settings}
                    disabled={versionOperationPending}
                    onChange={updateSettings}
                    onClose={() => setDrawerMode(null)}
                  />
                ) : drawerMode === "quality" ? (
                  <ResumeCompletenessPanel
                    result={completeness}
                    onClose={() => setDrawerMode(null)}
                  />
                ) : null}
              </motion.aside>
            )}
          </AnimatePresence>

          {saveErrorNoticeOpen && saveKind === "error" && (
            <div className="wb3-save-notice" role="alert">
              <span className="wb3-save-notice-icon" aria-hidden="true">!</span>
              <span>
                <strong>{t("保存失败")}</strong>
                <small>{saveErrorMessage}</small>
              </span>
              <button type="button" onClick={() => void retrySave()}>{t("重试")}</button>
            </div>
          )}
        </>
      )}
    </main>
  );

  const workbench = (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", bounce: 0, duration: 0.34 }}>
      <div className={`resume-workbench wb3${embedded ? " is-embedded" : ""}`} data-ui-theme="light">
        {!embedded && (
          <header className="wb3-head">
            <div className="wb3-head-left">
              <button type="button" className="wb3-home" aria-label={t("返回全部简历")} title={t("返回全部简历")} onClick={() => void leaveSafely()}>
                <Icon name="home" size={16} />
              </button>
              <span className="wb3-context">{t("简历编辑")}</span>
              <i className="wb3-head-sep" aria-hidden="true" />
              {editor && <WorkbenchHistoryActions editor={editor} />}
            </div>
            <div className="wb3-head-center">
              <WorkbenchTitleInput value={title} onChange={setTitle} disabled={versionOperationPending} />
              <WorkbenchSaveStatus dirty={dirty} saveStatus={saveStatus} error={saveError} />
            </div>
            <div className="wb3-head-actions">
              <WorkbenchScorePill result={completeness} active={drawerMode === "quality"} onClick={() => toggleDrawer("quality")} />
              <WorkbenchMoreMenu onDelete={() => setDeleteDialogOpen(true)} />
              <button
                type="button"
                className="v3-btn v3-btn-dark wb3-export"
                disabled={pdfExportPending || !activeResumeId}
                onClick={exportPdf}
              >
                {pdfExportPending ? t("导出中…") : t("导出 PDF")}
              </button>
            </div>
          </header>
        )}

        {activeResumeId && importWarnings.length > 0 && (
          <ImportWarningBanner
            warnings={importWarnings}
            onDismiss={() => dismissImportWarnings(activeResumeId)}
          />
        )}

        {activeResumeId && editor && (
          <StableSelectionToolbarBubble editor={editor} scale={renderedPreviewScale}>
            <SelectionFormattingToolbar editor={editor} />
          </StableSelectionToolbarBubble>
        )}

        {activeResumeId && editor && commandMenu && (
          <SlashCommandMenu
            editor={editor}
            resumeId={activeResumeId}
            state={commandMenu}
            onClose={() => setCommandMenu(null)}
            onNotice={(label) => setToast({ kind: "warning", label })}
          />
        )}

        {canvas}

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
        </AnimatePresence>
        <MotionPresence>{toast && (
          <Toast
            key={toast.label}
            kind={toast.kind === "warning" ? "warn" : toast.kind}
            title={toast.label}
            onDismiss={() => setToast(null)}
          />
        )}</MotionPresence>

        <MotionPresence>{deleteDialogOpen && (
          <ConfirmDialog
            title={t("删除“{value0}”？", { value0: title })}
            description={t("删除后无法恢复。求职记录会保留，关联简历将被清空。")}
            art={<DeleteResumeArt />}
            confirmLabel={t("永久删除")}
            busyLabel={t("正在删除…")}
            busy={deletePending}
            onCancel={() => setDeleteDialogOpen(false)}
            onConfirm={() => void confirmDeleteResume()}
          />
        )}</MotionPresence>
      </div>
    </MotionConfig>
  );

  if (embedded) return workbench;
  return (
    <V3Shell active="none" bare scroll={false} contentClassName="wb3-content">
      {workbench}
    </V3Shell>
  );
}

// 删除确认插图：迷你简历 + 红色垃圾桶角标（舞台 372×128，同 01.1j 的构图）
function DeleteResumeArt() {
  useLocale();
  return (
    <Centered width={372} height={128}>
      <MiniResume x={146} y={16} w={80} h={100} />
      <Badge x={212} y={84} size={30} icon="trash" fill="var(--v3-rd-soft)" color="var(--v3-rd)" border="#f1d4d4" />
    </Centered>
  );
}

function importWarningMessage(warning: string) {
  const messages: Record<string, string> = {
    pdf_ocr_applied: t("PDF 已使用 OCR，请核对姓名、日期和数字"),
    pdf_low_text_quality: t("PDF 文本质量偏低，请重点核对遗漏和错字"),
    docx_embedded_images_omitted: t("DOCX 中的图片未导入"),
    docx_textbox_order_may_change: t("DOCX 文本框的阅读顺序可能发生变化"),
    document_heading_structure_missing: t("原文缺少明确章节标题，已按全文识别"),
    source_quote_not_found: t("部分结构化内容无法定位到原文短句"),
    unparsed_work_start_date: t("部分工作开始日期未能识别"),
    unparsed_work_end_date: t("部分工作结束日期未能识别"),
    unmapped_fragments_preserved: t("部分原文已按自定义章节保留，请人工整理"),
  };
  return messages[warning] ?? t("部分内容需要人工核对");
}
