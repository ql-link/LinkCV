import { CircleAlert, CircleCheck, FileDown, Home, LogOut, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useResumeStore } from "../store/resumeStore";
import { exportResumePdf } from "../features/preview/exportPdf";

type SaveToast = {
  kind: "success" | "error";
  message: string;
};

export function Header() {
  const title = useResumeStore((state) => state.title);
  const setTitle = useResumeStore((state) => state.setTitle);
  const smartOnePage = useResumeStore((state) => state.settings.smartOnePage);
  const user = useResumeStore((state) => state.user);
  const saveStatus = useResumeStore((state) => state.saveStatus);
  const dirty = useResumeStore((state) => state.dirty);
  const saveCurrentResume = useResumeStore((state) => state.saveCurrentResume);
  const goHome = useResumeStore((state) => state.goHome);
  const logout = useResumeStore((state) => state.logout);
  const [saveToast, setSaveToast] = useState<SaveToast | null>(null);
  const [isManualSaving, setIsManualSaving] = useState(false);

  useEffect(() => {
    if (!saveToast) return;

    const timer = window.setTimeout(() => setSaveToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [saveToast]);

  const handleManualSave = async () => {
    setIsManualSaving(true);
    await saveCurrentResume();
    const latestError = useResumeStore.getState().error;
    setSaveToast(
      latestError
        ? { kind: "error", message: "保存失败" }
        : { kind: "success", message: "保存成功" },
    );
    setIsManualSaving(false);
  };

  return (
    <header className="top-nav">
      <div className="nav-left">
        <button className="icon-button circular" aria-label="回主页" onClick={goHome}>
          <Home size={16} />
        </button>
        <div className="nav-title-group">
          <input
            className="document-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="简历标题"
            placeholder="未命名简历"
          />
          <span className="save-status">
            {saveStatus === "saving"
              ? "保存中..."
              : saveStatus === "saved" && !dirty
                ? "已保存"
                : dirty
                  ? "未保存"
                  : user?.email}
          </span>
        </div>
      </div>
      <div className="nav-actions">
        <button className="button-secondary" onClick={() => void exportResumePdf(smartOnePage, title)}>
          <FileDown size={14} />
          导出 PDF
        </button>
        <button className="button-primary" disabled={isManualSaving} onClick={() => void handleManualSave()}>
          <Save size={14} />
          保存
        </button>
        <div className="nav-divider" />
        <button className="button-text-link danger" title="退出登录" onClick={() => void logout()}>
          <LogOut size={15} />
        </button>
      </div>
      {saveToast && (
        <div className={`save-toast ${saveToast.kind}`} role="status" aria-live="polite">
          {saveToast.kind === "success" ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
          {saveToast.message}
        </div>
      )}
    </header>
  );
}
