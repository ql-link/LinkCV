import { t, useLocale } from "@/i18n";
import { MotionPresence, MotionSurface } from "@/components/ui/motion";
import { X } from "lucide-react";
import { useResumeStore } from "../../store/resumeStore";
import { IconButton } from "@/components/ui";

type SourceModalProps = {
  html: string;
};

export function SourceModal({ html }: SourceModalProps) {
  useLocale();
  const showSource = useResumeStore((state) => state.settings.showSource);
  const updateSettings = useResumeStore((state) => state.updateSettings);

  return (
    <MotionPresence>{showSource && (
    <MotionSurface as="div" variant="overlay" className="modal-backdrop" role="presentation">
      <MotionSurface as="div" variant="dialog" className="source-modal" role="dialog" aria-modal="true" aria-label={t("渲染源码")}>
        <div className="modal-titlebar">
          <strong>{t("渲染源码")}</strong>
          <IconButton
            label={t("关闭")}
            onClick={() => updateSettings({ showSource: false })}
          >
            <X size={16} />
          </IconButton>
        </div>
        <pre>{html}</pre>
      </MotionSurface>
    </MotionSurface>
    )}</MotionPresence>
  );
}
