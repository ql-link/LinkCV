import { AppWindow, Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
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
      anchor.download = `linkresume-job-capture-v${release.version}.zip`;
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
        <div className="plugin-dialog-header">
          <h2 id="plugin-install-title">安装 LinkResume 岗位采集插件</h2>
          <span className="plugin-dialog-chip"><AppWindow size={13} aria-hidden="true" />支持 Chrome / Edge</span>
          <button className="plugin-dialog-close" type="button" aria-label="关闭插件安装说明" onClick={onClose}><X size={18} /></button>
        </div>

        <ol className="plugin-steps">
          <li className="plugin-step is-open">
            <span className="plugin-step-index" aria-hidden="true">1</span>
            <div className="plugin-step-body">
              <strong>下载并解压安装包</strong>
              <p>浏览器不能直接安装 ZIP。下载后，将文件解压到一个固定目录；之后不要移动或删除这个目录。</p>
              <div className="plugin-step-panel">
                {!result && !failed && <div className="plugin-release-state">正在检查安装包…</div>}
                {failed && <div className="plugin-release-state is-error" role="alert">暂时无法获取插件安装包，请稍后重试。</div>}
                {result?.status === "unpublished" && <div className="plugin-release-state">暂未提供插件安装包。</div>}
                {release && <Button className="plugin-download-link" icon={<Download size={15} />} disabled={downloading} onClick={() => void download()}>{downloading ? "正在下载…" : "下载插件 ZIP"}</Button>}
                {downloadError && <p className="plugin-release-state is-error" role="alert">{downloadError}</p>}
              </div>
            </div>
          </li>
          <PluginStep index="2" title="打开扩展管理页">在浏览器地址栏输入 <code>chrome://extensions</code>；使用 Edge 时输入 <code>edge://extensions</code>。</PluginStep>
          <PluginStep index="3" title="加载插件并固定到工具栏">开启“开发者模式”，点击“加载已解压的扩展程序”，选择包含 <code>manifest.json</code> 的解压目录。然后打开扩展菜单，将“LinkResume 岗位采集”固定到工具栏。</PluginStep>
          <PluginStep index="4" title="打开岗位并核对导入">先登录 LinkResume，再进入 BOSS 直聘岗位详情页；列表页中可以先选中右侧岗位。点击插件图标，检查职位、公司和薪资等信息，然后点击“确认导入”。插件不会自动投递或批量采集。</PluginStep>
          <PluginStep index="5" title="查看岗位与更新插件">导入成功后可在 JD 中心继续查看、编辑或删除。首次安装后请刷新已经打开的招聘页面；更新时覆盖原解压目录，并在扩展管理页点击“重新加载”。</PluginStep>
        </ol>
      </section>
    </div>
  );
}

function PluginStep({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return <li className="plugin-step"><span className="plugin-step-index" aria-hidden="true">{index}</span><div className="plugin-step-body"><strong>{title}</strong><p>{children}</p></div></li>;
}
