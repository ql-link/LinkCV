import { t, useLocale } from "@/i18n";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiRequestError, type PluginReleaseCurrentResponse } from "../../api/client";
import { PageLoading } from "@/components/ui";
import { Icon } from "@/v3/Icon";
import { Bar, Centered, DashArrow, Paper } from "@/v3/art";
import { Dialog, DialogFooter } from "@/v3/primitives";
import "./jobs.css";

// 04.1b 安装浏览器插件（600×620）：插图（招聘网页 → 看板「待投递」）+ 三步收纳卡片；底部左侧「查看岗位与更新插件」说明，右侧「完成」。
// 唯一强按钮是第 1 步里的「下载 ZIP」。下载与版本冲突处理保持原逻辑。
export function PluginInstallDialog({ onClose }: { onClose: () => void }) {
  useLocale();
  const [result, setResult] = useState<PluginReleaseCurrentResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [showUpdateHelp, setShowUpdateHelp] = useState(false);

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
          ? t("插件版本已经更新，请关闭窗口后重新打开再下载。")
          : t("下载暂不可用，请稍后重试。"),
      );
    } finally {
      setDownloading(false);
    }
  };
  return (
    <Dialog width={600} label={t("安装 DrawOffer 岗位采集插件")} onClose={onClose} className="job-dialog plugin-install-dialog" closable={false}>
      <div className="v3-dialog-body plugin-dialog-body">
        <div className="plugin-dialog-header">
          <h2 id="plugin-install-title" className="v3-dialog-title">{t("安装 DrawOffer 岗位采集插件")}</h2>
          <button className="v3-dialog-close plugin-dialog-close" type="button" aria-label={t("关闭插件安装说明")} onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <p className="v3-dialog-sub">{t("在招聘网站上一键把岗位存进岗位看板。")}<span className="plugin-dialog-chip"><Icon name="layout" size={12} />{t("支持 Chrome / Edge")}</span></p>
        <div className="v3-stage has-dots plugin-stage"><PluginArt /></div>
        <ol className="v3-gcard plugin-steps">
          <li className="v3-grow plugin-step is-open">
            <span className="plugin-step-index is-current v3-num" aria-hidden="true">1</span>
            <div className="plugin-step-body">
              <strong>{t("下载并解压安装包")}</strong>
              <p>{t("浏览器不能直接安装 ZIP。下载后解压到一个固定目录，之后不要移动或删除这个目录。")}</p>
              <div className="plugin-step-panel">
                {!result && !failed && <PageLoading label={t("正在检查安装包…")} scope="panel" />}
                {failed && <div className="plugin-release-state is-error" role="alert">{t("暂时无法获取插件安装包，请稍后重试。")}</div>}
                {result?.status === "unpublished" && <div className="plugin-release-state">{t("暂未提供插件安装包。")}</div>}
                {release && (
                  <div className="plugin-release-row">
                    <span className="plugin-release-icon" aria-hidden="true"><Icon name="puzzle" size={14} /></span>
                    <strong className="plugin-release-name">{t("DrawOffer 岗位采集插件")}</strong>
                  </div>
                )}
                {downloadError && <p className="plugin-release-state is-error" role="alert">{downloadError}</p>}
              </div>
            </div>
            {release && (
              <button className="v3-btn v3-btn-dark plugin-download-link" type="button" disabled={downloading} onClick={() => void download()}>
                {downloading ? t("正在下载…") : t("下载 ZIP")}
              </button>
            )}
          </li>
          <PluginStep index="2" title={t("打开扩展管理页")}>{t("在浏览器地址栏输入 ")}<code>chrome://extensions</code>{t("；使用 Edge 时输入 ")}<code>edge://extensions</code>。</PluginStep>
          <PluginStep index="3" title={t("加载插件并固定到工具栏")}>{t("开启“开发者模式”，点击“加载已解压的扩展程序”，选择包含 ")}<code>manifest.json</code>{t(" 的解压目录，再把“DrawOffer 岗位采集”固定到工具栏。")}</PluginStep>
          <PluginStep index="4" title={t("打开岗位并核对导入")}>{t("先登录 DrawOffer，再打开 BOSS 直聘岗位详情页，点击插件图标核对信息后“确认导入”，岗位会出现在“待投递”。插件不会自动投递或批量采集。")}</PluginStep>
          <PluginStep index="5" title={t("查看岗位与更新插件")} hidden={!showUpdateHelp}>{t("导入成功后可在求职记录中打开完整岗位并继续编辑。首次安装后请刷新已经打开的招聘页面；更新时覆盖原解压目录，并在扩展管理页点击“重新加载”。")}</PluginStep>
        </ol>
      </div>
      <DialogFooter left={(
        <button type="button" className="v3-link" aria-expanded={showUpdateHelp} onClick={() => setShowUpdateHelp((open) => !open)}>{t("查看岗位与更新插件")}<Icon name={showUpdateHelp ? "chevu" : "arrow"} size={12} /></button>
      )}>
        <button type="button" className="v3-btn v3-btn-ghost" onClick={onClose}>{t("完成")}</button>
      </DialogFooter>
    </Dialog>
  );
}

function PluginStep({ index, title, hidden = false, children }: { index: string; title: string; hidden?: boolean; children: ReactNode }) {
  useLocale();
  // 第 5 步默认收起，点左下角链接展开（折叠时仍在 DOM 里，屏幕阅读器可读）
  return (
    <li className={`v3-grow plugin-step${hidden ? " is-collapsed" : ""}`}>
      <span className="plugin-step-index v3-num" aria-hidden="true">{index}</span>
      <div className="plugin-step-body"><strong>{title}</strong><p>{children}</p></div>
    </li>
  );
}

// 插图：带插件图标的招聘网页 → 虚线箭头 → 看板「待投递」列里出现一张新卡片（舞台 536×120）
function PluginArt() {
  useLocale();
  return (
    <Centered width={536} height={120}>
      <Paper x={71} y={14} w={236} h={92}>
        <Bar x={0} y={0} w={236} h={18} color="var(--v3-field)" r={0} />
        {[8, 16, 24].map((left) => <span key={left} style={{ position: "absolute", left, top: 7, width: 5, height: 5, borderRadius: 3, background: "var(--v3-fl)" }} />)}
        <span style={{ position: "absolute", left: 36, top: 4, width: 140, height: 10, borderRadius: 5, background: "#fff", color: "var(--v3-fnt)", fontFamily: "var(--v3-num)", fontSize: 7, lineHeight: "10px", paddingLeft: 6 }}>zhipin.com/job_detail</span>
        <span style={{ position: "absolute", left: 212, top: 2, display: "grid", width: 16, height: 14, placeItems: "center", borderRadius: 4, background: "var(--v3-dark)", color: "#fff" }}><Icon name="puzzle" size={10} /></span>
        <Bar x={12} y={28} w={80} h={5} color="var(--v3-dark)" r={1} />
        <Bar x={12} y={38} w={120} h={3} color="var(--v3-sk2)" r={1} />
        {[48, 55, 62, 69].map((top, index) => <Bar key={top} x={12} y={top} w={[200, 180, 196, 120][index]} h={3} r={1} />)}
      </Paper>
      <DashArrow x={299} y={14} w={48} />
      <span style={{ position: "absolute", left: 345, top: 14, width: 120, height: 92, border: "1px solid var(--v3-line)", borderRadius: 8, background: "#fbfbfa" }}>
        <span style={{ position: "absolute", left: 10, top: 12, width: 6, height: 6, borderRadius: 3, background: "var(--v3-fnt)" }} />
        <span style={{ position: "absolute", left: 21, top: 8, color: "var(--v3-sub)", fontSize: 9.5, fontWeight: 500 }}>{t("待投递")}</span>
        <span style={{ position: "absolute", left: 8, top: 28, width: 104, height: 40, border: "1px solid var(--v3-dark)", borderRadius: 6, background: "#fff", boxShadow: "0 4px 12px rgb(0 0 0 / 8%)" }}>
          <span style={{ position: "absolute", left: 8, top: 6, color: "var(--v3-txt)", fontSize: 9.5, fontWeight: 500 }}>{t("后端开发工程师")}</span>
          <span style={{ position: "absolute", left: 8, top: 22, color: "var(--v3-fnt)", fontSize: 8 }}>{t("字节跳动 · 北京")}</span>
        </span>
        <span style={{ position: "absolute", left: 8, top: 74, width: 104, height: 12, border: "1px solid var(--v3-cl)", borderRadius: 4, background: "#fff", opacity: 0.6 }} />
      </span>
    </Centered>
  );
}
