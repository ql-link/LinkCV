import { memo, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiRequestError, type DatasetContent, type DatasetRecord } from "../../api/client";
import { Icon } from "../../v3/Icon";
import { Dialog } from "../../v3/primitives";
import { renderDatasetMarkdown } from "./datasetMarkdown";
import { renderDatasetMermaid } from "./datasetMermaid";
import { formatDatasetFileSize } from "./datasetUploadValidation";

type PreviewState =
  | { status: "loading" }
  | { status: "loaded"; content: DatasetContent }
  | { status: "error"; message: string };

function previewErrorMessage(error: unknown) {
  if (!(error instanceof ApiRequestError)) return "解析结果读取失败，请稍后重试。";
  if (error.message === "DATASET_CONTENT_UNAVAILABLE") {
    return "这份资料的解析结果暂不可查看，请稍后重试。";
  }
  if (error.message === "DATASET_NOT_FOUND") {
    return "这份资料不存在或你无权查看。";
  }
  return "解析结果读取失败，请稍后重试。";
}

function formatUploadDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })
    .format(date).replace(/\//g, "-");
}

// 06.1c 资料预览（820 宽）：衬线标题 + 「MD · 6 KB · 上传于… · 已关联：… · 管理关联」，
// 下面是浅底舞台里的白色文档（Markdown / Mermaid / 图片按解析结果渲染），没有底部按钮。
export function DatasetPreviewDialog({
  dataset,
  returnFocusTo,
  onClose,
  onManageAssociation,
}: {
  dataset: DatasetRecord;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onManageAssociation?: (dataset: DatasetRecord) => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const displayName = dataset.file_name.toLowerCase().endsWith(`.${dataset.file_format.toLowerCase()}`)
    ? dataset.file_name.slice(0, -(dataset.file_format.length + 1))
    : dataset.file_name;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void api.getDatasetContent(dataset.id).then(
      (content) => {
        if (!cancelled) setState({ status: "loaded", content });
      },
      (error) => {
        if (!cancelled) setState({ status: "error", message: previewErrorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [dataset.id, reloadKey]);

  const rendered = useMemo(
    () => state.status === "loaded" ? renderDatasetMarkdown(state.content.markdown) : "",
    [state],
  );

  const close = () => {
    onClose();
    // Dialog 卸载时会把焦点还给打开前的元素；列表刷新导致原元素被替换时，再退回到调用方指定的触发器
    window.setTimeout(() => {
      if (returnFocusTo && document.activeElement === document.body) returnFocusTo.focus();
    }, 0);
  };

  return (
    <Dialog width={820} label={displayName} onClose={close} className="ds-dialog ds-preview">
      <div className="v3-dialog-body" style={{ paddingBottom: 32 }}>
        <h2 className="v3-dialog-title" title={dataset.file_name}>{dataset.file_name}</h2>
        <div className="ds-preview-meta">
          <span className="v3-num">{dataset.file_format.toUpperCase()} · {formatDatasetFileSize(dataset.file_size)} · 上传于 {formatUploadDate(dataset.created_at)}</span>
          {(dataset.interview_label || onManageAssociation) && <span className="is-dot" aria-hidden="true">·</span>}
          {dataset.interview_label && (
            <span className="is-link"><Icon name="cal" size={13} />已关联：面试 · {dataset.interview_label}</span>
          )}
          {onManageAssociation && (
            <button type="button" className="v3-link" onClick={() => onManageAssociation(dataset)}>管理关联</button>
          )}
        </div>
        <div className="ds-preview-stage">
          <div className="ds-preview-doc" aria-live="polite">
            {state.status === "loading" && (
              <div className="ds-preview-state" role="status" aria-label="正在读取解析结果…">
                <span className="ds-spinner" aria-hidden="true" />正在读取解析结果…
              </div>
            )}
            {state.status === "error" && (
              <div className="ds-preview-state">
                <span role="alert">{state.message}</span>
                <button type="button" className="v3-btn v3-btn-ghost" onClick={() => setReloadKey((value) => value + 1)}>
                  <Icon name="refresh" size={13} />重新加载
                </button>
              </div>
            )}
            {state.status === "loaded" && <PreviewContent html={rendered} />}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// 列表轮询刷新时保留 Mermaid 已生成的 SVG
const PreviewContent = memo(function PreviewContent({ html }: { html: string }) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const controller = new AbortController();
    void renderDatasetMermaid(ref.current, controller.signal);
    return () => controller.abort();
  }, [html]);
  return <article ref={ref} className="ds-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
});
