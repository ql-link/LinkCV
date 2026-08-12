import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiRequestError, type PluginReleaseCurrentResponse } from "../../api/client";
import { Button } from "@/components/ui";

export function PluginInstallDialog({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<PluginReleaseCurrentResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.getPluginRelease().then(
      (value) => active && setResult(value),
      () => active && setFailed(true),
    );
    return () => { active = false; };
  }, []);

  const release = result?.release;
  const download = async () => {
    if (!release || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await api.downloadPluginRelease(release.version);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `linkcv-job-capture-v${release.version}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(
        error instanceof ApiRequestError && error.status === 409
          ? "插件版本已经更新，请关闭窗口后重新打开再下载。"
          : "下载暂不可用，请稍后重试。",
      );
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className="job-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="job-dialog plugin-install-dialog" role="dialog" aria-modal="true" aria-labelledby="plugin-install-title">
        <button className="plugin-dialog-close" type="button" aria-label="关闭插件安装说明" onClick={onClose}><X size={18} /></button>
        <p className="job-eyebrow">浏览器插件</p>
        <h2 id="plugin-install-title">安装岗位采集插件</h2>
        <p>在 BOSS 岗位详情页预览并导入 JD。插件采用 Chrome 开发者模式侧载，需要手工更新。</p>

        {!result && !failed && <div className="plugin-release-state">正在检查安装包…</div>}
        {failed && <div className="plugin-release-state is-error" role="alert">暂时无法获取插件安装包，请稍后重试。</div>}
        {result?.status === "unpublished" && <div className="plugin-release-state">暂未提供插件安装包。</div>}
        {release && (
          <>
            <ol className="plugin-install-steps">
              <li>下载 ZIP 并解压到固定目录。</li>
              <li>打开 <code>chrome://extensions</code>，启用“开发者模式”。</li>
              <li>点击“加载已解压的扩展程序”，选择包含 manifest.json 的目录。</li>
              <li>更新时下载新包，并在扩展管理页重新加载。</li>
            </ol>
            {downloadError && <p className="plugin-release-state is-error" role="alert">{downloadError}</p>}
            <Button className="plugin-download-link" icon={<Download size={16} />} disabled={downloading} onClick={() => void download()}>
              {downloading ? "正在下载…" : "下载插件"}
            </Button>
          </>
        )}
        <div className="job-dialog-actions"><Button variant="secondary" onClick={onClose}>关闭</Button></div>
      </section>
    </div>
  );
}
