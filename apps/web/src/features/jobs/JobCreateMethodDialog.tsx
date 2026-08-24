import { ArrowRight, BriefcaseBusiness, ClipboardPaste, FilePenLine, ImageUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";

export function JobCreateMethodDialog({
  onClose,
  onManual,
  onSmartImport,
}: {
  onClose: () => void;
  onManual: () => void;
  onSmartImport: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="job-method-dialog">
        <DialogHeader className="job-method-header">
          <DialogTitle className="job-method-title"><BriefcaseBusiness aria-hidden="true" />新建 JD</DialogTitle>
          <DialogDescription>选择录入方式，内容会在保存前进入同一份表单。</DialogDescription>
        </DialogHeader>
        <div className="job-method-options">
          <button type="button" className="job-method-option" onClick={onManual}>
            <span className="job-method-icon"><FilePenLine aria-hidden="true" /></span>
            <span className="job-method-copy"><strong>填写</strong><small>逐项录入岗位信息，适合精确整理。</small></span>
            <span className="job-method-action">开始填写<ArrowRight aria-hidden="true" /></span>
          </button>
          <button type="button" className="job-method-option" onClick={onSmartImport}>
            <span className="job-method-icon"><ClipboardPaste aria-hidden="true" /></span>
            <span className="job-method-copy"><strong>智能导入</strong><small>提供招聘文字或截图，自动整理为可编辑草稿。</small></span>
            <span className="job-method-action"><span className="job-method-kinds"><ClipboardPaste aria-hidden="true" />文字<ImageUp aria-hidden="true" />图片</span><ArrowRight aria-hidden="true" /></span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
