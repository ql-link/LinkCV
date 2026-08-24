import { ClipboardPaste, Image as ImageIcon, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiRequestError, type JobDescriptionDraft } from "../../api/client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FileUpload,
} from "@/components/ui";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function JobSmartImportDialog({
  onBack,
  onClose,
  onParsed,
}: {
  onBack: () => void;
  onClose: () => void;
  onParsed: (draft: JobDescriptionDraft, warnings: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const previewUrl = useMemo(() => image ? URL.createObjectURL(image) : "", [image]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => requestRef.current?.abort(), []);

  const leave = (destination: "back" | "close") => {
    requestRef.current?.abort();
    requestRef.current = null;
    if (destination === "back") onBack();
    else onClose();
  };

  const chooseImage = (file: File | undefined) => {
    if (!file) return;
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      setError("仅支持 PNG、JPEG 或 WebP 图片。");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("图片不能超过 10 MiB。");
      return;
    }
    setImage(file);
    setText("");
    setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedText = text.trim();
    if (!image && !normalizedText) {
      setError("请输入岗位文字或提供岗位图片。");
      return;
    }
    if (normalizedText.length > 60_000) {
      setError("岗位文字不能超过 60000 个字符。");
      return;
    }
    setBusy(true);
    setError("");
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const result = await api.parseJobDescriptionDraft(
        image
          ? { image, signal: controller.signal }
          : { text: normalizedText, signal: controller.signal },
      );
      if (!controller.signal.aborted && requestRef.current === controller) {
        onParsed(result.draft, result.warnings);
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(importErrorMessage(caught, image ? "image" : "text"));
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) leave("close"); }}>
      <DialogContent
        className="job-smart-import-dialog"
        onPaste={(event) => {
          if (busy) return;
          const pastedImage = Array.from(event.clipboardData.items)
            .find((item) => item.kind === "file" && item.type.startsWith("image/"))
            ?.getAsFile();
          if (pastedImage) {
            event.preventDefault();
            chooseImage(pastedImage);
          }
        }}
      >
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="job-smart-title"><Sparkles aria-hidden="true" />智能导入</DialogTitle>
            <DialogDescription>提供招聘内容，生成一份可继续修改的 JD 草稿。</DialogDescription>
          </DialogHeader>

          <div className="job-smart-import-body">
            <div className="job-smart-workspace">
              {image ? (
                <div className="job-smart-image-preview">
                  <img src={previewUrl} alt="待识别岗位截图预览" width="116" height="96" />
                  <div><ImageIcon aria-hidden="true" /><span><strong>{image.name}</strong><small>{formatBytes(image.size)}</small></span></div>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setImage(null)}>移除图片</Button>
                </div>
              ) : (
                <>
                  <label className="job-smart-text-field">
                    <span><ClipboardPaste aria-hidden="true" />岗位文字</span>
                    <textarea
                      aria-label="岗位文字"
                      name="job-source-text"
                      autoComplete="off"
                      value={text}
                      disabled={busy}
                      maxLength={60_001}
                      placeholder="粘贴职位名称、岗位职责、任职要求、薪资和公司信息…"
                      onChange={(event) => { setText(event.target.value); setError(""); }}
                    />
                    <small>{text.length.toLocaleString("zh-CN")} / 60,000</small>
                  </label>
                  <FileUpload
                    className="job-smart-image-upload"
                    accept="image/png,image/jpeg,image/webp"
                    inputLabel="选择岗位截图"
                    supportingText="PNG、JPEG 或 WebP，最大 10 MiB；也支持拖放、直接粘贴截图。"
                    browseLabel="选择图片"
                    disabled={busy}
                    onFileSelect={chooseImage}
                  />
                </>
              )}
            </div>
            {error && <p className="job-smart-error" role="alert">{error}</p>}
          </div>

          <DialogFooter className="job-smart-footer">
            <Button type="button" variant="ghost" onClick={() => leave("back")}>返回</Button>
            <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? "正在识别…" : "开始识别"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function importErrorMessage(error: unknown, inputType: "text" | "image"): string {
  if (!(error instanceof ApiRequestError)) return "暂时无法识别，请稍后重试。";
  if (error.message === "JD_IMPORT_MODEL_NOT_CONFIGURED") {
    return `${inputType === "image" ? "图片" : "文字"}解析模型尚未配置，请联系管理员或改为填写。`;
  }
  if (error.message === "JD_IMPORT_PARSE_TIMEOUT") return "识别超时，请重试或改为填写。";
  if (error.message === "JD_IMPORT_IMAGE_TOO_LARGE") return "图片不能超过 10 MiB。";
  if (error.message === "JD_IMPORT_IMAGE_UNSUPPORTED") return "仅支持 PNG、JPEG 或 WebP 图片。";
  if (error.message === "JD_IMPORT_IMAGE_INVALID") return "无法读取这张图片，请更换后重试。";
  if (error.message === "JD_IMPORT_TEXT_TOO_LARGE") return "岗位文字不能超过 60000 个字符。";
  if (error.message === "JD_IMPORT_PARSE_FAILED") {
    return `未能从${inputType === "image" ? "图片" : "文字"}中识别出有效岗位信息，请重试或改为填写。`;
  }
  return "暂时无法识别，请稍后重试。";
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
