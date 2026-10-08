import { t, useLocale } from "@/i18n";
import { useRef, useState } from "react";
import { api, ApiRequestError, type DatasetRecord } from "../../api/client";
import { Dialog, DialogFooter, Select } from "../../v3/primitives";
import { ConflictArt } from "./components/DatasetArt";

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

type Choice = "replace" | "rename";

// 06.1a 上传资料 · 同名文件（520 宽）：两个单选项「替换现有文件 / 保留两份」，底部唯一主按钮「上传」。
// 业务与旧版一致：替换走 replaceDataset（带 revision 与幂等键），保留两份走重命名后 uploadDataset；
// 结果不明确时锁定选项，只允许「重试确认结果」复用同一次请求。
export function DatasetUploadConflictDialog({
  conflict,
  onDone,
}: {
  conflict: DatasetConflict;
  onDone: () => void;
}) {
  useLocale();
  const [name, setName] = useState(conflict.suggestedName);
  const [target, setTarget] = useState(conflict.candidates[0]?.id ?? "");
  // 默认选中「保留两份」（与画板一致，也更安全）
  const [choice, setChoice] = useState<Choice>("rename");
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
  const selectedCandidate = conflict.candidates.find((c) => c.id === target);
  const replaceDisabled = !target || selectedCandidate?.replaceable === false;
  const locked = busy || uncertain;

  async function submit(replace: boolean) {
    const candidate = conflict.candidates.find((c) => c.id === target);
    if (
      !replace &&
      name.slice(name.lastIndexOf(".")).toLowerCase() !==
        conflict.file.name
          .slice(conflict.file.name.lastIndexOf("."))
          .toLowerCase()
    ) {
      setError(t("重命名时请保留原文件扩展名。"));
      return;
    }
    const request = attempt.current ?? {
      key: typeof crypto !== "undefined" && crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
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
        const dataset = await api.replaceDataset(
          request.target,
          conflict.file,
          request.revision,
          request.key,
        );
        done(dataset);
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
        setError(t("暂时无法确认上传结果，请重试以查询同一次上传。"));
      } else {
        attempt.current = null;
        setError(
          e.status === 412
            ? t("原文件已更新，请取消并重新上传，确认最新文件后再替换。")
            : t("操作未完成，文件可能正在处理中，或名称仍有冲突。"),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const existingName = selectedCandidate?.file_name ?? conflict.file.name;
  const primaryDisabled = locked
    ? busy
    : choice === "replace" ? replaceDisabled : !name.trim();

  return (
    <Dialog width={520} label={t("文件夹里已有同名文件")} className="ds-dialog" closable={!locked} onClose={() => { if (!locked) done(null); }}>
      <div className="v3-dialog-body">
        <h2 className="v3-dialog-title">{t("文件夹里已有同名文件")}</h2>
        <p className="v3-dialog-sub ds-one-line" title={existingName}>「{existingName}{t("」已经存在，选择要怎么处理。")}</p>
        <div className="v3-stage ds-dialog-art" style={{ height: 96 }}>
          <ConflictArt name={conflict.file.name} />
        </div>
        <div className="ds-options" role="radiogroup" aria-label={t("同名文件处理方式")}>
          <div
            className={`ds-option${replaceDisabled ? " is-disabled" : ""}`}
            role="radio"
            aria-checked={choice === "replace"}
            aria-disabled={replaceDisabled || locked}
            aria-label={t("替换现有文件")}
            tabIndex={0}
            onClick={() => { if (!replaceDisabled && !locked) setChoice("replace"); }}
            onKeyDown={(event) => {
              if ((event.key === " " || event.key === "Enter") && !replaceDisabled && !locked) {
                event.preventDefault();
                setChoice("replace");
              }
            }}
          >
            <span className={`v3-radio${choice === "replace" ? " is-on" : ""}`} aria-hidden="true" />
            <div className="ds-option-copy">
              <strong>{t("替换现有文件")}</strong>
              <small>{t("替换会先删除原文件和解析内容，再上传新文件；失败后不会恢复原文件。")}</small>
              {conflict.candidates.length > 1 && (
                <div onClick={(event) => event.stopPropagation()}>
                  <Select
                    size="sm"
                    label={t("选择要替换的文件")}
                    disabled={locked}
                    value={target}
                    options={conflict.candidates.map((c) => ({ value: c.id, label: `${c.file_name} · ${new Date(c.created_at).toLocaleString()}` }))}
                    onChange={(value) => { setTarget(value); setChoice("replace"); }}
                  />
                </div>
              )}
            </div>
          </div>
          <div
            className="ds-option"
            role="radio"
            aria-checked={choice === "rename"}
            aria-disabled={locked}
            aria-label={t("保留两份")}
            tabIndex={0}
            onClick={() => { if (!locked) setChoice("rename"); }}
            onKeyDown={(event) => {
              if ((event.key === " " || event.key === "Enter") && !locked && event.target === event.currentTarget) {
                event.preventDefault();
                setChoice("rename");
              }
            }}
          >
            <span className={`v3-radio${choice === "rename" ? " is-on" : ""}`} aria-hidden="true" />
            <div className="ds-option-copy">
              <strong>{t("保留两份")}</strong>
              <small>{t("给新文件换个名字。")}</small>
              <input
                id="conflict-name"
                className="v3-input is-filled"
                aria-label={t("新文件名称")}
                value={name}
                disabled={locked}
                onFocus={() => setChoice("rename")}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => { setName(event.target.value); setChoice("rename"); setError(""); }}
              />
              <span className="ds-option-hint">{t("重命名时请保留原文件扩展名。")}</span>
            </div>
          </div>
        </div>
        {error && <p className="ds-inline-error" role="alert">{error}</p>}
      </div>
      <DialogFooter>
        <button type="button" className="v3-btn v3-btn-ghost" style={{ width: 80 }} disabled={locked} onClick={() => done(null)}>{t("取消")}</button>
        {uncertain ? (
          <button type="button" className="v3-btn v3-btn-dark" disabled={busy} onClick={() => void submit(attempt.current?.replace ?? true)}>{t("重试确认结果")}</button>
        ) : (
          <button
            type="button"
            className="v3-btn v3-btn-dark"
            style={{ minWidth: 88 }}
            disabled={primaryDisabled}
            onClick={() => void submit(choice === "replace")}
          >
            {busy ? t("正在上传…") : t("上传")}
          </button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
