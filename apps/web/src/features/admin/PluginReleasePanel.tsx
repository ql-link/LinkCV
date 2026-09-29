import { CalendarClock, CloudUpload, Download, EyeOff, Package, Puzzle, Shield, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { FileUpload, type FileUploadHandle } from "@/components/ui";
import { api, ApiRequestError, type AdminPluginReleaseCurrentResponse } from "../../api/client";
import { ThinBars } from "./charts";
import {
  Button,
  Chip,
  ConfirmModal,
  ErrorState,
  LinkButton,
  LoadingRegion,
  PageHeader,
  SkBar,
  SkeletonChart,
  StatusDot,
  formatDateTime,
  formatDayLabel,
  formatNumber,
  useLoad,
} from "./kit";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function PluginReleasePanel() {
  const current = useLoad<AdminPluginReleaseCurrentResponse>(() => api.getAdminPluginRelease());
  const imports = useLoad(() => api.adminInsightJobImports());
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState<null | "upload" | "unpublish" | "delete">(null);
  const [busy, setBusy] = useState<"publish" | "unpublish" | "reactivate" | "delete" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const uploadRef = useRef<FileUploadHandle>(null);

  const state = current.data ?? { status: "absent" as const, release: null };
  const release = state.release;
  const hasPlugin = state.status !== "absent" && release !== null;

  const chooseFile = (selected: File | undefined) => {
    setMessage(null);
    if (!selected) return setFile(null);
    if (!selected.name.toLowerCase().endsWith(".zip")) { setFile(null); return setMessage("请选择 ZIP 插件安装包。"); }
    if (selected.size > MAX_UPLOAD_BYTES) { setFile(null); return setMessage("安装包不能超过 20 MB。"); }
    setFile(selected);
  };

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {
    setBusy(kind);
    setMessage(null);
    try { await action(); } finally { setBusy(null); setConfirm(null); }
  };

  const publish = () => run("publish", async () => {
    if (!file) return;
    try {
      const result = await api.adminPublishPluginRelease(file);
      current.setData({ status: "published", release: result.release });
      setFile(null);
      setMessage(result.cleanup_pending
        ? `v${result.release.version} 已更新，但旧版本安装包清理未完成，将在下次更新时重试。`
        : `v${result.release.version} 已${hasPlugin ? "更新" : "上传并上架"}。`);
    } catch (error) {
      setMessage(publishErrorMessage(error));
    }
  });

  const unpublish = () => run("unpublish", async () => {
    try {
      const result = await api.adminUnpublishPluginRelease();
      current.setData({ status: "unpublished", release: result.release });
      setMessage(`v${result.release.version} 已下架，安装包仍保留。`);
    } catch (error) { setMessage(operationErrorMessage(error, "下架")); }
  });

  const reactivate = () => run("reactivate", async () => {
    try {
      const result = await api.adminReactivatePluginRelease();
      current.setData({ status: "published", release: result.release });
      setMessage(`v${result.release.version} 已重新上架。`);
    } catch (error) { setMessage(operationErrorMessage(error, "重新上架")); }
  });

  const remove = () => run("delete", async () => {
    try {
      await api.adminDeletePluginRelease();
      current.setData({ status: "absent", release: null });
      setFile(null);
      setMessage("插件安装包和发布记录已永久删除。");
    } catch (error) {
      setMessage(operationErrorMessage(error, "删除"));
      void current.reload();
    }
  });

  const daily = imports.data?.daily ?? [];
  const statusDot = state.status === "published" ? { tone: "ok" as const, label: "已上架" } : state.status === "unpublished" ? { tone: "muted" as const, label: "已下架" } : { tone: "muted" as const, label: "未上传" };

  return (
    <>
      <PageHeader
        title="浏览器插件"
        actions={<Button variant="primary" disabled={busy !== null || current.loading} onClick={() => { setMessage(null); uploadRef.current?.open(); }}>{hasPlugin ? "上传新版本" : "上传插件"}</Button>}
      />
      {current.loading && !current.data ? (
        <LoadingRegion label="正在读取插件状态…"><div className="adm-release"><SkBar width={44} height={44} /><SkBar width={160} height={40} /><SkBar width={300} /></div></LoadingRegion>
      ) : current.error ? <ErrorState title="无法读取当前插件状态" code={current.error} onRetry={() => void current.reload()} /> : (
        <section className="adm-release" aria-label="当前发布">
          <div className="adm-release-name">
            <Chip icon={Puzzle} tint="blue" size={44} />
            <div><strong>{release ? "LinkResume 岗位采集插件" : "当前没有插件"}</strong><span>{release ? "Chrome / Edge · 在岗位页一键导入" : "上传首个安装包后，用户即可在 JD 页面下载。"}</span></div>
          </div>
          {release && (
            <>
              <p className="adm-release-version"><strong>v{release.version}</strong><StatusDot tone={statusDot.tone}>{statusDot.label}</StatusDot></p>
              <p className="adm-release-facts">
                <span><CalendarClock size={14} aria-hidden="true" />{formatDateTime(release.released_at).slice(0, 16)} 发布</span>
                <span><Package size={14} aria-hidden="true" />{formatSize(release.size)}</span>
                <span><Shield size={14} aria-hidden="true" />SHA-256 {release.sha256.slice(0, 8)}…</span>
              </p>
            </>
          )}
          {!release && <p className="adm-release-version"><StatusDot tone="muted">未上传</StatusDot></p>}
          <div className="adm-release-actions">
            {release && <a className="adm-btn adm-btn-secondary" href={release.download_url}><Download size={14} aria-hidden="true" />下载 ZIP</a>}
            {state.status === "published" && <Button disabled={busy !== null} onClick={() => setConfirm("unpublish")}><EyeOff size={14} aria-hidden="true" />下架</Button>}
            {state.status === "unpublished" && <Button disabled={busy !== null} onClick={() => void reactivate()}>{busy === "reactivate" ? "正在上架…" : "重新上架"}</Button>}
            {hasPlugin && <Button variant="danger" disabled={busy !== null} onClick={() => setConfirm("delete")}><Trash2 size={14} aria-hidden="true" />删除</Button>}
          </div>
        </section>
      )}
      <section className="adm-section" aria-label="上传更新">
        <FileUpload
          ref={uploadRef}
          className="adm-upload"
          icon={<CloudUpload />}
          accept=".zip,application/zip"
          inputLabel="选择插件 ZIP"
          supportingText="拖入 ZIP 或点击选择 · 最大 20 MB · 上传成功后立即上架并清理旧安装包"
          disabled={busy !== null}
          file={file}
          browseLabel={hasPlugin ? "选择更新包" : "选择文件"}
          replaceLabel="重新选择"
          onFileSelect={chooseFile}
        />
        {file && (
          <div className="adm-selected-file">
            <div><strong>{file.name}</strong><span>{formatSize(file.size)} · 待上传</span></div>
            <LinkButton tone="muted" disabled={busy !== null} onClick={() => { setFile(null); setMessage(null); }}>清除</LinkButton>
            <Button variant="primary" disabled={busy !== null} onClick={() => setConfirm("upload")}>{hasPlugin ? "确认更新" : "确认上传"}</Button>
          </div>
        )}
        {message && <p className="adm-message" role="status">{message}</p>}
      </section>
      <span className="adm-rule" aria-hidden="true" />
      <section className="adm-section adm-imports">
        <div className="adm-block-head">
          <div className="adm-block-title"><h2>岗位导入</h2><span>{imports.data?.sources.length ? `${imports.data.sources.map((source) => sourceLabels[source.site] ?? source.site).join("、")} · 最近 30 天` : "最近 30 天"}</span></div>
        </div>
        {imports.data && (
          <div className="adm-stat-row">
            <div><span>7 日导入</span><strong>{formatNumber(imports.data.imported7d)}</strong></div>
            <div><span>7 日使用用户</span><strong>{formatNumber(imports.data.users7d)}</strong></div>
            <div><span>30 日导入</span><strong>{formatNumber(imports.data.imported30d)}</strong></div>
          </div>
        )}
        {imports.loading && !imports.data ? <SkeletonChart height={220} /> : imports.error ? <ErrorState code={imports.error} onRetry={() => void imports.reload()} /> : (
          <ThinBars
            height={220}
            barWidth={18}
            ariaLabel="最近 30 天插件岗位导入"
            data={daily.map((day, index) => ({
              key: day.date,
              label: index === daily.length - 1 ? "今天" : `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8, 10))}`,
              value: day.count,
              tooltip: <><small>{formatDayLabel(day.date)}</small><strong>导入 {day.count} 个岗位</strong></>,
            }))}
          />
        )}
      </section>

      {confirm === "upload" && file && (
        <ConfirmModal width={460} title={hasPlugin ? "确认更新插件？" : "确认上传插件？"} confirmLabel={hasPlugin ? "确认更新" : "确认上传"} busyLabel="正在处理…" busy={busy !== null} onCancel={() => setConfirm(null)} onConfirm={() => void publish()}>
          <p>后端会校验 <strong>{file.name}</strong>。成功后立即上架该版本，并删除旧版本安装包。</p>
        </ConfirmModal>
      )}
      {confirm === "unpublish" && release && (
        <ConfirmModal width={460} title="确认下架插件？" confirmLabel="确认下架" busyLabel="正在下架…" danger busy={busy !== null} onCancel={() => setConfirm(null)} onConfirm={() => void unpublish()}>
          <p>用户将无法继续下载，但安装包仍会保留，之后可以直接重新上架。</p>
        </ConfirmModal>
      )}
      {confirm === "delete" && release && (
        <ConfirmModal width={460} title="永久删除插件？" confirmLabel="永久删除" busyLabel="正在删除…" danger busy={busy !== null} onCancel={() => setConfirm(null)} onConfirm={() => void remove()}>
          <p>将物理删除 v{release.version} 安装包和发布记录。此操作不可恢复，删除后需要重新上传。</p>
        </ConfirmModal>
      )}
    </>
  );
}

function publishErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "操作失败，请稍后重试。";
  if (error.status === 413) return "安装包超过 20 MB。";
  if (error.status === 409) return "版本低于当前版本，或相同版本的内容不一致。";
  if (error.status === 422) {
    if (error.message === "PLUGIN_RELEASE_INVALID_CONTENTS") return "安装包校验失败，未写入对象存储。ZIP 根目录必须包含 manifest.json。";
    if (error.message === "PLUGIN_RELEASE_INVALID_VERSION") return "安装包校验失败，未写入对象存储。Manifest 版本必须是三段数字版本。";
    if (error.message === "PLUGIN_RELEASE_UNSAFE_ARCHIVE") return "安装包校验失败，未写入对象存储。ZIP 包含不安全或重复的文件路径。";
    return "安装包校验失败，未写入对象存储。请检查 ZIP 和 Manifest。";
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

const sourceLabels: Record<string, string> = { zhipin: "BOSS 直聘" };

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
