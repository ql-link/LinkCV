import { CheckCircle2, PackageOpen, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiRequestError, type PluginRelease } from "../../api/client";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function PluginReleasePanel() {
  const [release, setRelease] = useState<PluginRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    setLoadError(false);
    api.getPluginRelease().then(
      (result) => setRelease(result.release),
      () => setLoadError(true),
    ).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const chooseFile = (selected: File | undefined) => {
    setMessage(null);
    if (!selected) return setFile(null);
    if (!selected.name.toLowerCase().endsWith(".zip")) {
      setFile(null);
      return setMessage("请选择 ZIP 插件安装包。");
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      return setMessage("安装包不能超过 20 MB。");
    }
    setFile(selected);
  };

  const publish = async () => {
    if (!file || publishing) return;
    setPublishing(true);
    setMessage(null);
    try {
      const result = await api.adminPublishPluginRelease(file);
      setRelease(result.release);
      setFile(null);
      setConfirming(false);
      if (inputRef.current) inputRef.current.value = "";
      setMessage(`v${result.release.version} 已发布，JD 下载入口已切换。`);
    } catch (error) {
      setConfirming(false);
      setMessage(publishErrorMessage(error));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <header className="admin-page-heading">
        <div><span className="page-eyebrow">浏览器插件</span><h1>插件发布</h1><p>上传当前环境的已构建 ZIP。后端校验通过后立即切换 JD 下载入口。</p></div>
      </header>
      <section className="admin-surface plugin-release-panel">
        <div className="surface-heading"><div><h2>当前正式版本</h2><p>安装包保存在当前环境的私有对象存储中</p></div><button className="admin-secondary-button" onClick={load}>刷新状态</button></div>
        {loading ? <p className="plugin-admin-state">正在读取…</p> : loadError ? <p className="plugin-admin-state is-error" role="alert">无法读取当前发布状态。</p> : release ? (
          <div className="plugin-current-card">
            <CheckCircle2 size={22} /><div><strong>v{release.version}</strong><p>{formatDate(release.released_at)} · {formatSize(release.size)}</p><small>SHA-256 {release.sha256}</small></div>
          </div>
        ) : <p className="plugin-admin-state">当前环境尚未发布插件。</p>}

        <div className="plugin-upload-zone">
          <PackageOpen size={30} />
          <div><strong>上传插件安装包</strong><p>只上传当前环境的 ZIP；版本和权限由后端自动解析校验。</p></div>
          <input ref={inputRef} aria-label="选择插件 ZIP" type="file" accept=".zip,application/zip" onChange={(event) => chooseFile(event.target.files?.[0])} />
        </div>
        {file && <div className="plugin-selected-file"><span>{file.name}</span><small>{formatSize(file.size)}</small><button className="admin-primary-button" onClick={() => setConfirming(true)}><Upload size={15} />发布插件</button></div>}
        {message && <p className="plugin-admin-message" role="status">{message}</p>}
      </section>

      {confirming && file && <div className="plugin-admin-dialog-backdrop"><section className="plugin-admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby="plugin-publish-title"><h2 id="plugin-publish-title">确认发布插件？</h2><p>后端会校验 <strong>{file.name}</strong>。成功后当前环境的 JD 下载入口会立即切换，已有版本不会被覆盖。</p><div><button className="admin-secondary-button" disabled={publishing} onClick={() => setConfirming(false)}>取消</button><button className="admin-primary-button" disabled={publishing} onClick={() => void publish()}>{publishing ? "正在校验并发布…" : "确认发布"}</button></div></section></div>}
    </>
  );
}

function publishErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "发布失败，请稍后重试。";
  if (error.status === 413) return "安装包超过 20 MB。";
  if (error.status === 409) return "版本低于当前版本，或相同版本的内容不一致。";
  if (error.status === 422) return "安装包校验失败，请检查 Manifest、环境权限和离线说明。";
  if (error.status === 503) return "对象存储暂不可用，当前版本没有切换。";
  return "发布失败，请稍后重试。";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
