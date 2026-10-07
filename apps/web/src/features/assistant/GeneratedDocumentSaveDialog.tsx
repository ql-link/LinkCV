import { useEffect, useRef, useState } from "react";
import { api, ApiRequestError, type DatasetFolder, type DatasetRecord } from "@/api/client";
import { t, useLocale } from "@/i18n";
import { Icon } from "@/v3/Icon";
import { Dialog, DialogFooter } from "@/v3/primitives";
import type { GeneratedDocument } from "./PreviewPanel";

type UploadAttempt = { file: File; folderId: string; key: string };

export function GeneratedDocumentSaveDialog({ document, onClose, onSaved }: {
  document: GeneratedDocument | null;
  onClose: () => void;
  onSaved: (record: DatasetRecord) => void;
}) {
  useLocale();
  const [folders, setFolders] = useState<DatasetFolder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [folderName, setFolderName] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [lockedFolderId, setLockedFolderId] = useState<string | null>(null);
  const attempts = useRef(new Map<string, UploadAttempt>());
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!document) return;
    let live = true;
    const attempt = attempts.current.get(document.id);
    setFolderId(attempt?.folderId ?? "");
    setLockedFolderId(attempt?.folderId ?? null);
    setFolderName("");
    setFolders([]);
    setError(null);
    setLoading(true);
    void api.listDatasetFolders().then((result) => {
      if (live) setFolders(result.folders);
    }).catch(() => {
      if (live) setError(t("文件夹列表加载失败，请重试。"));
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [document?.id, reload]);

  const createFolder = async () => {
    if (!folderName.trim() || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const folder = await api.createDatasetFolder(folderName.trim());
      if (!mounted.current) return;
      setFolders((items) => [...items, folder]);
      setFolderId(folder.id);
      setFolderName("");
    } catch {
      if (mounted.current) setError(t("文件夹创建失败，请检查名称后重试。"));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const save = async () => {
    if (!document || !folderId || inFlight.current) return;
    let attempt = attempts.current.get(document.id);
    if (!attempt) {
      if (!folders.some((folder) => folder.id === folderId)) return;
      attempt = { file: new File([document.content], document.label, { type: "text/markdown" }), folderId, key: crypto.randomUUID() };
      attempts.current.set(document.id, attempt);
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setLockedFolderId(attempt.folderId);
    try {
      let record: DatasetRecord;
      try {
        record = await api.uploadDataset(attempt.file, attempt.key, attempt.folderId);
      } catch (error) {
        if (!(error instanceof ApiRequestError && error.message === "DATASET_NAME_CONFLICT")) throw error;
        // 同名冲突是明确拒绝；保留两份时建立新的请求。网络结果不明时继续复用这个请求。
        const key = crypto.randomUUID();
        const name = document.label.replace(/(\.md)?$/u, `-${Date.now()}-${key.slice(0, 8)}.md`);
        attempt = { file: new File([document.content], name, { type: "text/markdown" }), folderId: attempt.folderId, key };
        attempts.current.set(document.id, attempt);
        record = await api.uploadDataset(attempt.file, attempt.key, attempt.folderId);
      }
      attempts.current.delete(document.id);
      if (mounted.current) onSaved(record);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ApiRequestError && (error.status === 401 || error.message === "FOLDER_NOT_FOUND" || error.message === "DATASET_NAME_CONFLICT")) {
        attempts.current.delete(document.id);
        setLockedFolderId(null);
      }
      if (error instanceof ApiRequestError && error.message === "FOLDER_NOT_FOUND") {
        setFolderId("");
        setError(t("目标文件夹已不可用，请重新加载后选择。"));
      } else {
        setError(error instanceof ApiRequestError && error.status === 401
          ? t("登录已过期，请重新登录后保存。")
          : t("保存到资料库失败，请稍后重试。"));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  if (!document) return null;
  return <Dialog width={480} label={t("保存文档到资料库")} className="assistant-save-dialog" closable={!busy} onClose={onClose}>
    <div className="v3-dialog-body">
      <h2 className="v3-dialog-title">{t("保存到资料库")}</h2>
      <p className="v3-dialog-sub">{document.label}</p>
      {loading ? <p role="status">{t("正在加载…")}</p> : <>
        <div className="v3-gcard assistant-save-folders" role="radiogroup" aria-label={t("目标文件夹列表")}>
          {folders.map((folder) => <button key={folder.id} type="button" className={`v3-grow${folder.id === folderId ? " is-selected" : ""}`} role="radio" aria-checked={folder.id === folderId} disabled={busy || lockedFolderId !== null} onClick={() => setFolderId(folder.id)}>
            <Icon name="folder" size={15} /><span className="v3-grow-copy"><strong>{folder.name}</strong></span>{folder.id === folderId && <Icon name="check" size={14} />}
          </button>)}
        </div>
        {folders.length === 0 && !error && <p>{t("还没有文件夹，请先新建一个。")}</p>}
        {lockedFolderId === null && <div className="assistant-save-create">
          <label className="v3-visually-hidden" htmlFor="assistant-save-folder-name">{t("文件夹名称")}</label>
          <input id="assistant-save-folder-name" value={folderName} maxLength={64} disabled={busy} placeholder={t("文件夹名称")} onChange={(event) => setFolderName(event.target.value)} />
          <button type="button" className="v3-btn v3-btn-ghost" disabled={busy || !folderName.trim()} onClick={() => void createFolder()}>{t("新建文件夹")}</button>
        </div>}
        {lockedFolderId !== null && <p className="assistant-save-hint">{t("重试将继续保存到原文件夹，避免重复创建资料。")}</p>}
      </>}
      {error && <div className="assistant-context-error" role="alert"><p>{error}</p><button type="button" className="v3-btn v3-btn-text" disabled={busy} onClick={() => setReload((value) => value + 1)}>{t("重新加载")}</button></div>}
    </div>
    <DialogFooter>
      <button type="button" className="v3-btn v3-btn-ghost" disabled={busy} onClick={onClose}>{t("取消")}</button>
      <button type="button" className="v3-btn v3-btn-dark" disabled={busy || loading || !folderId} onClick={() => void save()}>{busy ? t("正在保存…") : t("确认保存")}</button>
    </DialogFooter>
  </Dialog>;
}
