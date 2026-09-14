import { useRef, useState } from "react";
import { api, ApiRequestError, type DatasetRecord } from "../../api/client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Label,
  FeedbackNotice,
} from "@/components/ui";

export type DatasetConflict = {
  id: string;
  file: File;
  folderId: string;
  candidates: Array<{
    id: string;
    file_name: string;
    content_revision: string;
    created_at: string;
    replaceable?: boolean;
  }>;
  suggestedName: string;
  resolve: (value: DatasetRecord | null) => void;
};

export function DatasetUploadConflictDialog({
  conflict,
  onDone,
}: {
  conflict: DatasetConflict;
  onDone: () => void;
}) {
  const [name, setName] = useState(conflict.suggestedName);
  const [target, setTarget] = useState(conflict.candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{
    key: string;
    replace: boolean;
    name: string;
    target: string;
    revision: string;
  } | null>(null);
  const done = (value: DatasetRecord | null) => {
    conflict.resolve(value);
    onDone();
  };

  async function submit(replace: boolean) {
    const candidate = conflict.candidates.find((c) => c.id === target);
    if (
      !replace &&
      name.slice(name.lastIndexOf(".")).toLowerCase() !==
        conflict.file.name
          .slice(conflict.file.name.lastIndexOf("."))
          .toLowerCase()
    ) {
      setError("重命名时请保留原文件扩展名。");
      return;
    }
    const request = attempt.current ?? {
      key: crypto.randomUUID(),
      replace,
      name,
      target,
      revision: candidate?.content_revision ?? "0",
    };
    attempt.current = request;
    setBusy(true);
    setError("");
    try {
      if (request.replace) {
        window.dispatchEvent(
          new CustomEvent("dataset-replacement-start", {
            detail: request.target,
          }),
        );
        await api.replaceDataset(
          request.target,
          conflict.file,
          request.revision,
          request.key,
        );
        done(await api.getDataset(request.target));
      } else {
        const renamed = new File([conflict.file], request.name, {
          type: conflict.file.type,
          lastModified: conflict.file.lastModified,
        });
        done(await api.uploadDataset(renamed, request.key, conflict.folderId));
      }
    } catch (e) {
      const ambiguous = !(e instanceof ApiRequestError) || e.status >= 500;
      setUncertain(ambiguous);
      if (ambiguous) {
        setError("暂时无法确认上传结果，请重试以查询同一次上传。");
      } else {
        attempt.current = null;
        setError(
          e.status === 412
            ? "原文件已更新，请取消并重新上传，确认最新文件后再替换。"
            : "操作未完成，文件可能正在处理中，或名称仍有冲突。",
        );
        window.dispatchEvent(new Event("dataset-replacement-refresh"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !uncertain) done(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>文件夹内已有同名文件</DialogTitle>
          <DialogDescription>
            替换会覆盖原文件和解析内容。也可以重命名新文件，保留两份。
          </DialogDescription>
        </DialogHeader>
        {conflict.candidates.length > 1 && (
          <>
            <Label htmlFor="replace-target">选择要替换的文件</Label>
            <select
              id="replace-target"
              value={target}
              disabled={busy || uncertain}
              onChange={(e) => setTarget(e.target.value)}
            >
              {conflict.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.file_name} · {new Date(c.created_at).toLocaleString()}
                </option>
              ))}
            </select>
          </>
        )}
        <Label htmlFor="conflict-name">新文件名称</Label>
        <Input
          id="conflict-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy || uncertain}
        />
        {error && <FeedbackNotice kind="error">{error}</FeedbackNotice>}
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={busy || uncertain}
            onClick={() => done(null)}
          >
            取消
          </Button>
          {uncertain ? (
            <Button
              disabled={busy}
              onClick={() => void submit(attempt.current?.replace ?? true)}
            >
              重试确认结果
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={busy || !name.trim()}
                onClick={() => void submit(false)}
              >
                重命名并上传
              </Button>
              <Button
                disabled={
                  busy ||
                  !target ||
                  conflict.candidates.find((c) => c.id === target)
                    ?.replaceable === false
                }
                onClick={() => void submit(true)}
              >
                {busy ? "正在上传…" : "替换现有文件"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
