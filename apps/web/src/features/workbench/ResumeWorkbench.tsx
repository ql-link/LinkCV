import { EditorContent, useEditor } from "@tiptap/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  AlertTriangle,
  CircleCheck,
  FileDown,
  History,
  Home,
  LogOut,
  Minus,
  Plus,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiRequestError } from "../../api/client";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { exportResumePdf } from "../preview/exportPdf";
import { resumeSerifFontStack, useResumeStore } from "../../store/resumeStore";
import { resumeEditorExtensions } from "./editorExtensions";
import { WorkbenchToolbar } from "./WorkbenchToolbar";
import { handleWheelZoom } from "./workbenchZoom";
import { navigateTo } from "../../routing";

type DrawerMode = "settings" | "history" | null;
type ToastState = { label: string } | null;

const EMPTY_IMPORT_WARNINGS: string[] = [];

const fontOptions = [
  { label: "简历宋体", value: resumeSerifFontStack },
  { label: "霞鹜文楷", value: '"LXGW WenKai", KaiTi, STKaiti, "Songti SC", serif' },
  { label: "系统黑体", value: '"PingFang SC", "Microsoft YaHei", Inter, system-ui, sans-serif' },
];

const versionReasonLabels = {
  initial: "初始版本",
  manual: "手动保存",
  before_restore: "恢复前备份",
  restore: "恢复结果",
} as const;

function versionTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function versionOperationErrorMessage(error: unknown, operation: "create" | "restore") {
  if (!(error instanceof ApiRequestError) || error.message !== "RESUME_VERSION_LIMIT_REACHED") {
    return null;
  }
  return operation === "create"
    ? "当前内容已保存，但版本数量已达上限。请删除一个旧版本后再保存新版本。"
    : "版本空间不足，恢复操作没有执行。请删除一个旧版本后再重试。";
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

function ActionButton({ primary, active, children, onClick, disabled }: { primary?: boolean; active?: boolean; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <motion.button
      type="button"
      className={`workbench-action${primary ? " primary" : ""}${active ? " active" : ""}`}
      aria-pressed={active === undefined ? undefined : active}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", bounce: 0, duration: 0.32 }}
      onClick={onClick}
      disabled={disabled}
    >{children}</motion.button>
  );
}

export function SmartOnePageAction({ active, onToggle, disabled }: { active: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <ActionButton active={active} onClick={onToggle} disabled={disabled}>
      <Sparkles size={14} />智能一页
    </ActionButton>
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

function IconAction({ label, active, danger, children, onClick }: { label: string; active?: boolean; danger?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      className={`workbench-icon-action${active ? " active" : ""}${danger ? " danger" : ""}`}
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", bounce: 0, duration: 0.32 }}
      onClick={onClick}
    >{children}</motion.button>
  );
}

function Stepper({ label, value, min, max, step, onChange, disabled }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; disabled?: boolean }) {
  const change = (direction: -1 | 1) => onChange(Number(Math.min(max, Math.max(min, value + direction * step)).toFixed(2)));
  return (
    <div className="workbench-stepper" aria-label={label}>
      <motion.button type="button" aria-label={`${label}减小`} whileTap={{ scale: 0.92 }} onClick={() => change(-1)} disabled={disabled}><Minus size={12} /></motion.button>
      <strong>{value}</strong>
      <motion.button type="button" aria-label={`${label}增大`} whileTap={{ scale: 0.92 }} onClick={() => change(1)} disabled={disabled}><Plus size={12} /></motion.button>
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
  const deleteStoredVersion = useResumeStore((state) => state.deleteVersion);
  const restoreStoredVersion = useResumeStore((state) => state.restoreVersion);
  const goHome = useResumeStore((state) => state.goHome);
  const logout = useResumeStore((state) => state.logout);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [pendingVersionDelete, setPendingVersionDelete] = useState<{
    versionNo: number;
    createdAt: string;
  } | null>(null);
  const paperScrollRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: resumeEditorExtensions,
    content: editorContent,
    editorProps: {
      attributes: { class: "resume-content", spellcheck: "false" },
      transformPastedHTML: plainParagraphsFromHtml,
    },
    onCreate: ({ editor: current }) => {
      current.commands.setTextSelection(Math.max(1, current.state.doc.content.size - 1));
      current.commands.blur();
    },
    onUpdate: ({ editor: current }) => setEditorContent(current.getJSON()),
  }, [activeResumeId]);

  useEffect(() => {
    editor?.setEditable(!versionOperationPending);
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
      handleWheelZoom(previewScale, event, setPreviewScale);
    };

    scrollArea.addEventListener("wheel", handleWheel, { passive: false });
    return () => scrollArea.removeEventListener("wheel", handleWheel);
  }, [previewScale, setPreviewScale]);

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

  const manualSave = async () => {
    if (!editor) return;
    await saveCurrentResume();
    if (useResumeStore.getState().error) {
      setToast({ label: "保存失败，请稍后重试" });
      return;
    }
    try {
      await createVersion();
      setToast({ label: "已保存新版本" });
    } catch (error) {
      const limitMessage = versionOperationErrorMessage(error, "create");
      if (limitMessage) setDrawerMode("history");
      setToast({ label: limitMessage ?? "当前内容已保存，但版本创建失败" });
    }
  };

  const restoreVersion = async (versionNo: number, createdAt: string) => {
    if (!editor) return;
    editor.setEditable(false);
    try {
      await restoreStoredVersion(versionNo);
      const restored = useResumeStore.getState().editorContent;
      editor.commands.setContent(restored);
      setToast({ label: `已恢复 ${versionTime(createdAt)} 的版本` });
    } catch (error) {
      const limitMessage = versionOperationErrorMessage(error, "restore");
      if (limitMessage) setDrawerMode("history");
      setToast({ label: limitMessage ?? "版本恢复失败，请稍后重试" });
    } finally {
      editor.setEditable(true);
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

  const leaveSafely = async (destination: "home" | "logout") => {
    if (dirty) {
      await saveCurrentResume();
      if (useResumeStore.getState().error) {
        setToast({ label: "保存失败，已留在当前页面，请重试" });
        return;
      }
    }
    if (destination === "home") {
      goHome();
      navigateTo("/resumes");
    } else {
      await logout();
      navigateTo("/", { replace: true });
    }
  };

  const statusText = saveStatus === "saving" ? "保存中..." : saveStatus === "error" ? "保存失败 · 请重试" : dirty ? "编辑中" : "已保存";
  const zoomPercent = Math.round(previewScale * 100);
  const importWarnings = activeResumeId
    ? importWarningsByResumeId[activeResumeId] ?? EMPTY_IMPORT_WARNINGS
    : EMPTY_IMPORT_WARNINGS;

  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", bounce: 0, duration: 0.34 }}>
      <div className="resume-workbench">
        <header className="workbench-header">
          <div className="workbench-header-left">
            <IconAction label="回主页" onClick={() => void leaveSafely("home")}><Home size={16} /></IconAction>
            <input className="workbench-title" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="简历标题" disabled={versionOperationPending} />
            <span className={`workbench-save-status ${!dirty && saveStatus === "saved" ? "saved" : ""}${saveStatus === "error" ? " error" : ""}`}><i />{statusText}</span>
          </div>
          <div className="workbench-header-actions">
            <SmartOnePageAction
              active={settings.smartOnePage}
              onToggle={() => updateSettings({ smartOnePage: !settings.smartOnePage })}
              disabled={versionOperationPending}
            />
            <IconAction label="页面设置" active={drawerMode === "settings"} onClick={() => setDrawerMode((mode) => mode === "settings" ? null : "settings")}><SlidersHorizontal size={16} /></IconAction>
            <IconAction label="版本记录" active={drawerMode === "history"} onClick={() => setDrawerMode((mode) => mode === "history" ? null : "history")}><History size={16} /></IconAction>
            <ActionButton onClick={() => void exportResumePdf(settings.smartOnePage, title)}><FileDown size={14} />导出 PDF</ActionButton>
            <ActionButton primary disabled={saveStatus === "saving" || versionOperationPending} onClick={() => void manualSave()}><Save size={14} />保存版本</ActionButton>
            <span className="workbench-header-divider" />
            <IconAction label="个人资料" onClick={() => navigateTo("/account")}><UserRound size={15} /></IconAction>
            <IconAction label="退出登录" danger onClick={() => void leaveSafely("logout")}><LogOut size={15} /></IconAction>
          </div>
        </header>

        {activeResumeId && importWarnings.length > 0 && (
          <ImportWarningBanner
            warnings={importWarnings}
            onDismiss={() => dismissImportWarnings(activeResumeId)}
          />
        )}

        {activeResumeId && <WorkbenchToolbar editor={editor} resumeId={activeResumeId} onNotice={(label) => setToast({ label })} />}

        <main className="workbench-canvas">
          <div
            ref={paperScrollRef}
            className="workbench-paper-scroll"
            style={{ "--workbench-preview-scale": previewScale } as React.CSSProperties}
          >
            <article className={`resume-paper${settings.smartOnePage ? " smart-one-page" : ""}`} style={resumeStyle} aria-label="可编辑简历页面">
              <EditorContent editor={editor} />
            </article>
            <p className="workbench-page-hint">
              {settings.smartOnePage ? "智能一页 · 导出为连续单页" : "标准 A4 · 超出内容自动分页导出"}
            </p>
          </div>
          <output className="workbench-zoom-indicator" aria-label="简历缩放比例">{zoomPercent}%</output>

          <AnimatePresence initial={false}>
            {drawerMode && (
              <motion.aside
                className="workbench-drawer"
                role="region"
                aria-labelledby="workbench-drawer-title"
                initial={{ x: 360 }}
                animate={{ x: 0 }}
                exit={{ x: 360 }}
                transition={{ type: "spring", bounce: 0, duration: 0.36 }}
              >
                <div className="workbench-drawer-head">
                  <h2 id="workbench-drawer-title">{drawerMode === "settings" ? "页面设置" : "版本记录"}</h2>
                  <button type="button" onClick={() => setDrawerMode(null)} aria-label="关闭面板">×</button>
                </div>
                {drawerMode === "settings" ? (
                  <div className="workbench-settings">
                    <label><span>全局字体</span><select value={settings.fontFamily} onChange={(event) => updateSettings({ fontFamily: event.target.value })} disabled={versionOperationPending}>{fontOptions.map((font) => <option key={font.label} value={font.value}>{font.label}</option>)}</select></label>
                    <label><span>全局字号</span><Stepper label="全局字号" value={settings.fontSize} min={8} max={16} step={0.5} onChange={(fontSize) => updateSettings({ fontSize })} disabled={versionOperationPending} /></label>
                    <label><span>行距</span><Stepper label="行距" value={settings.lineHeight} min={1.1} max={1.8} step={0.05} onChange={(lineHeight) => updateSettings({ lineHeight })} disabled={versionOperationPending} /></label>
                    <label><span>左右边距</span><Stepper label="左右边距" value={settings.pageMargin} min={10} max={30} step={2} onChange={(pageMargin) => updateSettings({ pageMargin })} disabled={versionOperationPending} /></label>
                    <label><span>上下边距</span><Stepper label="上下边距" value={settings.verticalPageMargin} min={10} max={30} step={2} onChange={(verticalPageMargin) => updateSettings({ verticalPageMargin })} disabled={versionOperationPending} /></label>
                  </div>
                ) : (
                  <div className="workbench-versions">
                    <p className="workbench-version-guidance">
                      每份简历最多保存 10 个版本。达到上限时不会自动删除；请手动清理旧版本，最新版本需保留。
                    </p>
                    {versionsLoading && <p className="workbench-empty">正在读取版本记录…</p>}
                    {!versionsLoading && versions.length === 0 && <p className="workbench-empty">暂无可用版本。</p>}
                    {versions.map((version) => (
                      <div className="version-row" key={version.id}>
                        <div className="version-row-copy"><strong>{versionTime(version.created_at)}</strong><span>v{version.version_no} · {versionReasonLabels[version.reason]}</span></div>
                        <span className="version-row-actions">
                          <button type="button" disabled={versionOperationPending} onClick={() => void restoreVersion(version.version_no, version.created_at)}>恢复</button>
                          {version.version_no !== versions[0]?.version_no && (
                            <button
                              type="button"
                              className="version-delete-action"
                              aria-label={`删除版本 v${version.version_no}`}
                              disabled={versionOperationPending}
                              onClick={() => setPendingVersionDelete({ versionNo: version.version_no, createdAt: version.created_at })}
                            >
                              <Trash2 size={13} />删除
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
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
