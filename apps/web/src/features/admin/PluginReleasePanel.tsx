import { CheckCircle2, PackageOpen, RefreshCw, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  api,
  ApiRequestError,
  type AdminPluginReleaseCurrentResponse,
} from "../../api/client";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function PluginReleasePanel() {
  const [current, setCurrent] = useState<AdminPluginReleaseCurrentResponse>({
    status: "absent",
    release: null,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confirmingUpload, setConfirmingUpload] = useState(false);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState<"publish" | "unpublish" | "reactivate" | "delete" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const release = current.release;
  const hasPlugin = current.status !== "absent" && release !== null;
  const isUpdating = hasPlugin;

  const load = () => {
    setLoading(true);
    setLoadError(false);
    api.getAdminPluginRelease().then(
      setCurrent,
      () => setLoadError(true),
    ).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const clearFile = () => {
    setFile(null);
    setConfirmingUpload(false);
    setMessage(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const chooseFile = (selected: File | undefined) => {
    setMessage(null);
    if (!selected) return setFile(null);
    if (!selected.name.toLowerCase().endsWith(".zip")) {
      clearFile();
      return setMessage("请选择 ZIP 插件安装包。");
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      clearFile();
      return setMessage("安装包不能超过 20 MB。");
    }
    setFile(selected);
  };

  const publish = async () => {
    if (!file || busy) return;
    setBusy("publish");
    setMessage(null);
    try {
      const result = await api.adminPublishPluginRelease(file);
      setCurrent({ status: "published", release: result.release });
      setFile(null);
      setConfirmingUpload(false);
      if (inputRef.current) inputRef.current.value = "";
      setMessage(result.cleanup_pending
        ? `v${result.release.version} 已更新，但旧版本安装包清理未完成，将在下次更新时重试。`
        : `v${result.release.version} 已${isUpdating ? "更新" : "上传并上架"}。`);
    } catch (error) {
      setConfirmingUpload(false);
      setMessage(publishErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async () => {
    if (!release || busy) return;
    setBusy("unpublish");
    setMessage(null);
    try {
      const result = await api.adminUnpublishPluginRelease();
      setCurrent({ status: "unpublished", release: result.release });
      setConfirmingUnpublish(false);
      setMessage(`v${result.release.version} 已下架，安装包仍保留。`);
    } catch (error) {
      setConfirmingUnpublish(false);
      setMessage(operationErrorMessage(error, "下架"));
    } finally {
      setBusy(null);
    }
  };

  const reactivate = async () => {
    if (!release || busy) return;
    setBusy("reactivate");
    setMessage(null);
    try {
      const result = await api.adminReactivatePluginRelease();
      setCurrent({ status: "published", release: result.release });
      setMessage(`v${result.release.version} 已重新上架。`);
    } catch (error) {
      setMessage(operationErrorMessage(error, "重新上架"));
    } finally {
      setBusy(null);
    }
  };

  const deleteRelease = async () => {
    if (!release || busy) return;
    setBusy("delete");
    setMessage(null);
    try {
      await api.adminDeletePluginRelease();
      setCurrent({ status: "absent", release: null });
      setConfirmingDelete(false);
      clearFile();
      setMessage("插件安装包和发布记录已永久删除。");
    } catch (error) {
      setConfirmingDelete(false);
      try {
        setCurrent(await api.getAdminPluginRelease());
      } catch {
        setLoadError(true);
      }
      setMessage(operationErrorMessage(error, "删除"));
    } finally {
      setBusy(null);
    }
  };

  const openFilePicker = () => {
    setMessage(null);
    inputRef.current?.click();
  };

  return (
    <>
      <header className="admin-page-heading plugin-page-heading">
        <div><span className="page-eyebrow">浏览器插件</span><h1>插件发布</h1><p>管理当前环境唯一的岗位采集插件版本。</p></div>
        <button className="admin-secondary-button" disabled={loading || busy !== null} onClick={load}><RefreshCw size={15} />刷新状态</button>
      </header>

      <section className="admin-surface plugin-release-panel">
        {loading ? <p className="plugin-admin-state">正在读取插件状态…</p> : loadError ? <p className="plugin-admin-state is-error" role="alert">无法读取当前插件状态。</p> : (
          <div className={`plugin-status-card is-${current.status}`}>
            <div className="plugin-status-icon">{hasPlugin ? <CheckCircle2 size={24} /> : <PackageOpen size={24} />}</div>
            <div className="plugin-status-copy">
              <span className="plugin-status-badge">{current.status === "published" ? "已上架" : current.status === "unpublished" ? "已下架" : "未上传"}</span>
              <h2>{release ? `岗位采集插件 v${release.version}` : "当前没有插件"}</h2>
              {release ? <><p>{formatDate(release.released_at)} · {formatSize(release.size)}</p><small>SHA-256 {release.sha256}</small></> : <p>上传首个安装包后，用户即可在 JD 页面下载。</p>}
            </div>
            <div className="plugin-status-actions">
              <button className="admin-primary-button" disabled={busy !== null} onClick={openFilePicker}><Upload size={15} />{hasPlugin ? "更新插件" : "上传插件"}</button>
              {current.status === "published" && <button className="admin-secondary-button" disabled={busy !== null} onClick={() => setConfirmingUnpublish(true)}>下架插件</button>}
              {current.status === "unpublished" && <button className="admin-secondary-button" disabled={busy !== null} onClick={() => void reactivate()}><RotateCcw size={15} />{busy === "reactivate" ? "正在上架…" : "重新上架"}</button>}
              {hasPlugin && <button className="admin-danger-button is-quiet" disabled={busy !== null} onClick={() => setConfirmingDelete(true)}><Trash2 size={15} />删除插件</button>}
            </div>
          </div>
        )}

        <input ref={inputRef} className="plugin-file-input" aria-label="选择插件 ZIP" type="file" accept=".zip,application/zip" onChange={(event) => chooseFile(event.target.files?.[0])} />
        {file && <div className="plugin-selected-file"><div><span>{file.name}</span><small>{formatSize(file.size)}</small></div><div className="plugin-selected-file-actions"><button className="admin-secondary-button" disabled={busy !== null} onClick={clearFile}>清除</button><button className="admin-primary-button" disabled={busy !== null} onClick={() => setConfirmingUpload(true)}>{isUpdating ? "确认更新" : "确认上传"}</button></div></div>}
        {message && <p className="plugin-admin-message" role="status">{message}</p>}
      </section>

      {confirmingUpload && file && <ConfirmDialog title={isUpdating ? "确认更新插件？" : "确认上传插件？"} onCancel={() => setConfirmingUpload(false)} confirmLabel={busy === "publish" ? "正在处理…" : isUpdating ? "确认更新" : "确认上传"} disabled={busy !== null} onConfirm={() => void publish()}><p>后端会校验 <strong>{file.name}</strong>。成功后立即上架该版本，并删除旧版本安装包。</p></ConfirmDialog>}
      {confirmingUnpublish && release && <ConfirmDialog title="确认下架插件？" onCancel={() => setConfirmingUnpublish(false)} confirmLabel={busy === "unpublish" ? "正在下架…" : "确认下架"} disabled={busy !== null} onConfirm={() => void unpublish()} danger><p>用户将无法继续下载，但安装包仍会保留，之后可以直接重新上架。</p></ConfirmDialog>}
      {confirmingDelete && release && <ConfirmDialog title="永久删除插件？" onCancel={() => setConfirmingDelete(false)} confirmLabel={busy === "delete" ? "正在删除…" : "永久删除"} disabled={busy !== null} onConfirm={() => void deleteRelease()} danger><p>将物理删除 v{release.version} 安装包和发布记录。此操作不可恢复，删除后需要重新上传。</p></ConfirmDialog>}
    </>
  );
}

function ConfirmDialog({ title, children, confirmLabel, disabled, danger = false, onCancel, onConfirm }: { title: string; children: ReactNode; confirmLabel: string; disabled: boolean; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  const titleId = "plugin-confirm-dialog-title";
  return <div className="plugin-admin-dialog-backdrop"><section className="plugin-admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}><h2 id={titleId}>{title}</h2>{children}<div><button className="admin-secondary-button" disabled={disabled} onClick={onCancel}>取消</button><button className={danger ? "admin-danger-button" : "admin-primary-button"} disabled={disabled} onClick={onConfirm}>{confirmLabel}</button></div></section></div>;
}

function publishErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "操作失败，请稍后重试。";
  if (error.status === 413) return "安装包超过 20 MB。";
  if (error.status === 409) return "版本低于当前版本，或相同版本的内容不一致。";
  if (error.status === 422) {
    if (error.message === "PLUGIN_RELEASE_INVALID_CONTENTS") return "安装包校验失败，未写入对象存储。ZIP 根目录必须包含 manifest.json 和安装说明。";
    if (error.message === "PLUGIN_RELEASE_INVALID_PERMISSIONS") return "安装包校验失败，未写入对象存储。Manifest 站点权限与当前环境不一致。";
    if (error.message === "PLUGIN_RELEASE_INVALID_VERSION") return "安装包校验失败，未写入对象存储。Manifest 版本必须是三段数字版本。";
    if (error.message === "PLUGIN_RELEASE_UNSAFE_ARCHIVE") return "安装包校验失败，未写入对象存储。ZIP 包含不安全或重复的文件路径。";
    return "安装包校验失败，未写入对象存储。请检查 ZIP、Manifest 和离线说明。";
  }
  if (error.status === 503) return "对象存储暂不可用，当前版本没有切换。";
  return "操作失败，请稍后重试。";
}

function operationErrorMessage(error: unknown, action: string): string {
  if (!(error instanceof ApiRequestError)) return `${action}失败，请稍后重试。`;
  if (error.status === 404) return "当前插件不存在，请刷新状态。";
  if (error.status === 409) return "插件状态已经变化，请刷新后重试。";
  if (error.status === 503) return `${action}未完成，已重新读取当前状态，请重试。`;
  return `${action}失败，请稍后重试。`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
