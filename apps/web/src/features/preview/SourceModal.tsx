import { X } from "lucide-react";
import { useResumeStore } from "../../store/resumeStore";

type SourceModalProps = {
  html: string;
};

export function SourceModal({ html }: SourceModalProps) {
  const showSource = useResumeStore((state) => state.settings.showSource);
  const updateSettings = useResumeStore((state) => state.updateSettings);

  if (!showSource) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="source-modal" role="dialog" aria-modal="true" aria-label="渲染源码">
        <div className="modal-titlebar">
          <strong>渲染源码</strong>
          <button
            className="icon-button ghost"
            aria-label="关闭"
            onClick={() => updateSettings({ showSource: false })}
          >
            <X size={16} />
          </button>
        </div>
        <pre>{html}</pre>
      </div>
    </div>
  );
}
