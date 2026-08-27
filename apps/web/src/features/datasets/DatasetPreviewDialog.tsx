import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiRequestError, type DatasetContent, type DatasetRecord } from "../../api/client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FeedbackNotice,
  PageLoading,
} from "@/components/ui";
import { renderDatasetMarkdown } from "./datasetMarkdown";
import { renderDatasetMermaid } from "./datasetMermaid";

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

function formatUploadTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(/\//g, "-");
}

export function DatasetPreviewDialog({
  dataset,
  returnFocusTo,
  onClose,
}: {
  dataset: DatasetRecord;
  returnFocusTo: HTMLElement | null;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const previewRef = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    if (state.status !== "loaded") return;
    const container = previewRef.current;
    if (!container) return;

    const controller = new AbortController();
    void renderDatasetMermaid(container, controller.signal);
    return () => controller.abort();
  }, [rendered, state.status]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="dataset-preview-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo?.focus();
          onClose();
        }}
      >
        <DialogHeader className="dataset-preview-header">
          <DialogTitle title={displayName}>{displayName}</DialogTitle>
          <DialogDescription>上传于 {formatUploadTime(dataset.created_at)}</DialogDescription>
        </DialogHeader>

        <div className="dataset-preview-body" aria-live="polite">
          {state.status === "loading" && (
            <PageLoading label="正在读取解析结果…" scope="panel" />
          )}
          {state.status === "error" && (
            <div className="dataset-preview-error">
              <FeedbackNotice kind="error">{state.message}</FeedbackNotice>
              <Button variant="secondary" size="sm" onClick={() => setReloadKey((value) => value + 1)}>
                重新加载
              </Button>
            </div>
          )}
          {state.status === "loaded" && (
            <article
              ref={previewRef}
              className="dataset-markdown-preview"
              dangerouslySetInnerHTML={{ __html: rendered }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
