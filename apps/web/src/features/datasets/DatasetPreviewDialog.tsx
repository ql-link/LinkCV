import { useEffect, useMemo, useState } from "react";
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

export function DatasetPreviewDialog({
  dataset,
  returnFocusTo,
  onClose,
}: {
  dataset: DatasetRecord;
  returnFocusTo: HTMLButtonElement | null;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<PreviewState>({ status: "loading" });

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
          <DialogTitle title={dataset.file_name}>{dataset.file_name}</DialogTitle>
          <DialogDescription>
            {dataset.file_format.toUpperCase()} · 解析结果
          </DialogDescription>
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
              className="dataset-markdown-preview"
              dangerouslySetInnerHTML={{ __html: rendered }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
