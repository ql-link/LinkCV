import { CircleAlert, CircleCheck, FileDown, Home, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { exportResumePdf, resumePdfExportErrorMessage } from "../features/preview/pdfExport";
import { useResumeStore } from "../store/resumeStore";
import { Brand, Button, FeedbackNotice, IconButton } from "@/components/ui";

type SaveToast = {
  kind: "success" | "error";
  message: string;
};

export function Header() {
  const title = useResumeStore((state) => state.title);
  const activeResumeId = useResumeStore((state) => state.activeResumeId);
  const setTitle = useResumeStore((state) => state.setTitle);
  const user = useResumeStore((state) => state.user);
  const saveStatus = useResumeStore((state) => state.saveStatus);
  const dirty = useResumeStore((state) => state.dirty);
  const saveCurrentResume = useResumeStore((state) => state.saveCurrentResume);
  const goHome = useResumeStore((state) => state.goHome);
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
        <IconButton label="回主页" variant="circular" onClick={goHome}>
          <Home size={16} />
        </IconButton>
        <Brand />
        <div className="nav-divider" />
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
        <Button variant="secondary" icon={<FileDown size={14} />} disabled={!activeResumeId} onClick={() => {
          if (!activeResumeId) return;
          void exportResumePdf({
            resumeId: activeResumeId,
            title,
            saveCurrentResume,
            getSnapshot: () => {
              const state = useResumeStore.getState();
              return {
                activeResumeId: state.activeResumeId,
                lockVersion: state.lockVersion,
                saveStatus: state.saveStatus,
              };
            },
          }).catch((error) => setSaveToast({
            kind: "error",
            message: resumePdfExportErrorMessage(error),
          }));
        }}>
          导出 PDF
        </Button>
        <Button icon={<Save size={14} />} disabled={isManualSaving} onClick={() => void handleManualSave()}>
          保存
        </Button>
      </div>
      {saveToast && (
        <FeedbackNotice kind={saveToast.kind}>
          {saveToast.kind === "success" ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
          {saveToast.message}
        </FeedbackNotice>
      )}
    </header>
  );
}
