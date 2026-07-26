import { EditorContent, useEditor } from "@tiptap/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
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
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { exportResumePdf } from "../preview/exportPdf";
import { resumeSerifFontStack, useResumeStore } from "../../store/resumeStore";
import { resumeEditorExtensions } from "./editorExtensions";
import { WorkbenchToolbar } from "./WorkbenchToolbar";
import { loadVersionHistory, saveVersionHistory, type VersionSnapshot } from "./versionHistory";
import { handleWheelZoom } from "./workbenchZoom";
import { navigateTo } from "../../routing";

type DrawerMode = "settings" | "history" | null;
type ToastState = { label: string; undo?: () => void } | null;

const fontOptions = [
  { label: "简历宋体", value: resumeSerifFontStack },
  { label: "霞鹜文楷", value: '"LXGW WenKai", KaiTi, STKaiti, "Songti SC", serif' },
  { label: "系统黑体", value: '"PingFang SC", "Microsoft YaHei", Inter, system-ui, sans-serif' },
];

function nowText() {
  const date = new Date();
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
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

export function SmartOnePageAction({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <ActionButton active={active} onClick={onToggle}>
      <Sparkles size={14} />智能一页
    </ActionButton>
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

function Stepper({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  const change = (direction: -1 | 1) => onChange(Number(Math.min(max, Math.max(min, value + direction * step)).toFixed(2)));
  return (
    <div className="workbench-stepper" aria-label={label}>
      <motion.button type="button" aria-label={`${label}减小`} whileTap={{ scale: 0.92 }} onClick={() => change(-1)}><Minus size={12} /></motion.button>
      <strong>{value}</strong>
      <motion.button type="button" aria-label={`${label}增大`} whileTap={{ scale: 0.92 }} onClick={() => change(1)}><Plus size={12} /></motion.button>
    </div>
  );
}

export function ResumeWorkbench() {
  const activeResumeId = useResumeStore((state) => state.activeResumeId);
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
  const goHome = useResumeStore((state) => state.goHome);
  const logout = useResumeStore((state) => state.logout);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const lastSaveStatus = useRef(saveStatus);
  const latestAutoSnapshot = useRef("");
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
    let cancelled = false;
    setVersions([]);
    latestAutoSnapshot.current = "";
    lastSaveStatus.current = saveStatus;
    if (!activeResumeId) return;

    void loadVersionHistory(activeResumeId)
      .then((stored) => {
        if (!cancelled) {
          setVersions(stored);
          latestAutoSnapshot.current = stored[0] ? JSON.stringify(stored[0].json) : "";
        }
      })
      .catch(() => {
        if (!cancelled) setToast({ label: "版本记录暂时无法读取" });
      });

    return () => {
      cancelled = true;
    };
  }, [activeResumeId]);

  const appendVersion = (snapshot: VersionSnapshot) => {
    setVersions((current) => {
      const next = [snapshot, ...current].slice(0, 20);
      if (activeResumeId) {
        void saveVersionHistory(activeResumeId, next).catch(() => setToast({ label: "版本已保存，但本地记录写入失败" }));
      }
      return next;
    });
  };

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

  useEffect(() => {
    if (lastSaveStatus.current === "saving" && saveStatus === "saved" && editor) {
      const json = editor.getJSON();
      const key = JSON.stringify(json);
      if (key !== latestAutoSnapshot.current) {
        latestAutoSnapshot.current = key;
        const snapshot: VersionSnapshot = { id: crypto.randomUUID(), label: "自动保存", time: nowText(), json };
        appendVersion(snapshot);
      }
    }
    lastSaveStatus.current = saveStatus;
  }, [editor, saveStatus]);

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
    const json = editor.getJSON();
    latestAutoSnapshot.current = JSON.stringify(json);
    const snapshot: VersionSnapshot = { id: crypto.randomUUID(), label: "手动保存", time: nowText(), json };
    appendVersion(snapshot);
    setToast({ label: "已保存新版本" });
  };

  const restoreVersion = (version: VersionSnapshot) => {
    if (!editor) return;
    const previous = editor.getJSON();
    editor.commands.setContent(version.json);
    setEditorContent(version.json);
    setToast({ label: `已恢复 ${version.time} 的版本`, undo: () => {
      editor.commands.setContent(previous);
      setEditorContent(previous);
    } });
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

  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", bounce: 0, duration: 0.34 }}>
      <div className="resume-workbench">
        <header className="workbench-header">
          <div className="workbench-header-left">
            <IconAction label="回主页" onClick={() => void leaveSafely("home")}><Home size={16} /></IconAction>
            <input className="workbench-title" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="简历标题" />
            <span className={`workbench-save-status ${!dirty && saveStatus === "saved" ? "saved" : ""}${saveStatus === "error" ? " error" : ""}`}><i />{statusText}</span>
          </div>
          <div className="workbench-header-actions">
            <SmartOnePageAction
              active={settings.smartOnePage}
              onToggle={() => updateSettings({ smartOnePage: !settings.smartOnePage })}
            />
            <IconAction label="页面设置" active={drawerMode === "settings"} onClick={() => setDrawerMode((mode) => mode === "settings" ? null : "settings")}><SlidersHorizontal size={16} /></IconAction>
            <IconAction label="版本记录" active={drawerMode === "history"} onClick={() => setDrawerMode((mode) => mode === "history" ? null : "history")}><History size={16} /></IconAction>
            <ActionButton onClick={() => void exportResumePdf(settings.smartOnePage, title)}><FileDown size={14} />导出 PDF</ActionButton>
            <ActionButton primary disabled={saveStatus === "saving"} onClick={() => void manualSave()}><Save size={14} />保存版本</ActionButton>
            <span className="workbench-header-divider" />
            <IconAction label="退出登录" danger onClick={() => void leaveSafely("logout")}><LogOut size={15} /></IconAction>
          </div>
        </header>

        <WorkbenchToolbar editor={editor} onNotice={(label) => setToast({ label })} />

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
                    <label><span>全局字体</span><select value={settings.fontFamily} onChange={(event) => updateSettings({ fontFamily: event.target.value })}>{fontOptions.map((font) => <option key={font.label} value={font.value}>{font.label}</option>)}</select></label>
                    <label><span>全局字号</span><Stepper label="全局字号" value={settings.fontSize} min={8} max={16} step={0.5} onChange={(fontSize) => updateSettings({ fontSize })} /></label>
                    <label><span>行距</span><Stepper label="行距" value={settings.lineHeight} min={1.1} max={1.8} step={0.05} onChange={(lineHeight) => updateSettings({ lineHeight })} /></label>
                    <label><span>左右边距</span><Stepper label="左右边距" value={settings.pageMargin} min={10} max={30} step={2} onChange={(pageMargin) => updateSettings({ pageMargin })} /></label>
                    <label><span>上下边距</span><Stepper label="上下边距" value={settings.verticalPageMargin} min={10} max={30} step={2} onChange={(verticalPageMargin) => updateSettings({ verticalPageMargin })} /></label>
                  </div>
                ) : (
                  <div className="workbench-versions">
                    {versions.length === 0 && <p className="workbench-empty">修改内容后会自动生成版本，也可以点击“保存版本”。</p>}
                    {versions.map((version, index) => (
                      <div className={index === 0 ? "version-row current" : "version-row"} key={version.id}>
                        <div><strong>{version.time}</strong><span>{version.label}{index === 0 ? " · 当前" : ""}</span></div>
                        {index !== 0 && <button type="button" onClick={() => restoreVersion(version)}>恢复</button>}
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
              {toast.undo && <button type="button" onClick={() => { toast.undo?.(); setToast(null); }}>撤销</button>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
