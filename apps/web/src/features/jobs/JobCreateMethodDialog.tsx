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
          <DialogTitle className="job-method-title">导入岗位</DialogTitle>
          <DialogDescription>选择一种录入方式，内容会在保存前进入同一份可编辑表单。</DialogDescription>
        </DialogHeader>
        <div className="job-method-options">
          <button type="button" className="job-method-option" onClick={onManual}>
            <span className="job-method-icon" aria-hidden="true">01</span>
            <span className="job-method-copy"><strong>手工填写</strong><small>逐项填写职位、公司和岗位要求，适合信息明确时使用。</small></span>
            <span className="job-method-action">开始填写</span>
          </button>
          <button type="button" className="job-method-option" onClick={onSmartImport}>
            <span className="job-method-icon" aria-hidden="true">02</span>
            <span className="job-method-copy"><strong>文本导入</strong><small>粘贴招聘文字，自动整理成可继续修改的岗位草稿。</small></span>
            <span className="job-method-action">粘贴文字</span>
          </button>
          <button type="button" className="job-method-option" onClick={onSmartImport}>
            <span className="job-method-icon" aria-hidden="true">03</span>
            <span className="job-method-copy"><strong>图片导入</strong><small>上传、拖放或直接粘贴岗位截图，自动识别其中的信息。</small></span>
            <span className="job-method-action">选择图片</span>
          </button>
        </div>
        <div className="job-method-footer" aria-label="导入说明">
          <p>文本最多 60,000 字；图片支持 PNG、JPEG、WebP，最大 10 MiB。</p>
          <p>识别完成后仍可修改全部岗位信息</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
