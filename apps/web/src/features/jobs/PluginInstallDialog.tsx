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
        <span className="plugin-dialog-chip">支持 Chrome / Edge</span>
        <button className="plugin-dialog-close" type="button" aria-label="关闭插件安装说明" onClick={onClose}><X size={18} /></button>
        <h2 id="plugin-install-title">安装岗位采集插件</h2>
        <p>用浏览器扩展一键保存招聘网站上的岗位信息。</p>

        <ol className="plugin-steps">
          <li className="plugin-step is-open">
            <span className="plugin-step-index" aria-hidden="true">1</span>
            <div className="plugin-step-body">
              <strong>下载插件</strong>
              <p>获取 LinkCV 岗位采集插件安装包</p>
              {!result && !failed && <div className="plugin-release-state">正在检查安装包…</div>}
              {failed && <div className="plugin-release-state is-error" role="alert">暂时无法获取插件安装包，请稍后重试。</div>}
              {result?.status === "unpublished" && <div className="plugin-release-state">暂未提供插件安装包。</div>}
              {release && (
                <div className="plugin-step-panel">
                  <p>下载 ZIP 并解压到固定目录，打开 <code>chrome://extensions</code> 启用“开发者模式”，选择“加载已解压的扩展程序”。</p>
                  <p>更新时下载新包，并在扩展管理页重新加载。</p>
                  {downloadError && <p className="plugin-release-state is-error" role="alert">{downloadError}</p>}
                  <Button className="plugin-download-link" icon={<Download size={15} />} disabled={downloading} onClick={() => void download()}>
                    {downloading ? "正在下载…" : "下载插件"}
                  </Button>
                </div>
              )}
            </div>
          </li>
          <li className="plugin-step">
            <span className="plugin-step-index" aria-hidden="true">2</span>
            <div className="plugin-step-body">
              <strong>安装并固定</strong>
              <p>在工具栏固定 LinkCV，方便随时保存岗位</p>
            </div>
          </li>
          <li className="plugin-step">
            <span className="plugin-step-index" aria-hidden="true">3</span>
            <div className="plugin-step-body">
              <strong>开始采集</strong>
              <p>打开招聘网站，点击 LinkCV 图标保存岗位</p>
            </div>
          </li>
        </ol>

        <div className="plugin-dialog-footer">
          <p>完成安装后返回此页，刷新即可开始使用。</p>
          <Button onClick={onClose}>我已安装，刷新状态</Button>
        </div>
      </section>
    </div>
  );
}
