import { Copy, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ResumeShareState, type ResumeShareUpdatePayload } from "../../api/client";
import {
  ConfirmDialog,
  PageLoading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";

function parseShareExpiry(expiresAt: string | null) {
  if (!expiresAt) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(expiresAt);
  const time = Date.parse(hasTimezone ? expiresAt : `${expiresAt}Z`);
  return Number.isFinite(time) ? time : null;
}

function isShareExpired(expiresAt: string | null) {
  const time = parseShareExpiry(expiresAt);
  return time !== null && time < Date.now();
}

function formatShareExpiry(expiresAt: string | null, expired = false) {
  if (!expiresAt) return "永久";
  const time = parseShareExpiry(expiresAt);
  if (time === null) return "到期时间不可用";
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
  return expired ? `已于 ${date} 过期` : `有效至 ${date}`;
}

type SharePanelProps = {
  resumeId: string;
  resumeTitle: string;
  onClose: () => void;
};

const EXPIRY_OPTIONS = [
  {
    key: "7d",
    label: "7 天",
    expiresAt: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    key: "1m",
    label: "30 天",
    expiresAt: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    key: "forever",
    label: "永久",
    expiresAt: () => null,
  },
] as const;

type ExpiryKey = (typeof EXPIRY_OPTIONS)[number]["key"];

function shareUrl(token: string) {
  return `${window.location.origin}/share/${token}`;
}

function matchExpiry(expiresAt: string | null): ExpiryKey | null {
  if (!expiresAt) return "forever";
  const time = parseShareExpiry(expiresAt);
  if (time === null) return null;
  for (const option of EXPIRY_OPTIONS) {
    if (option.key === "forever") continue;
    if (Math.abs(time - Date.parse(option.expiresAt() as string)) < 60 * 60 * 1000) {
      return option.key;
    }
  }
  return null;
}

export function SharePanel({ resumeId, resumeTitle, onClose }: SharePanelProps) {
  const [share, setShare] = useState<ResumeShareState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createVisibility, setCreateVisibility] = useState<"private" | "public">("public");
  const [createExpiry, setCreateExpiry] = useState<ExpiryKey>("forever");
  const [createAllowDownload, setCreateAllowDownload] = useState(true);
  const [allowDownloadPending, setAllowDownloadPending] = useState(false);
  const allowDownloadPendingRef = useRef(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const result = await api.getShareState(resumeId);
    setShare(result.share);
  }, [resumeId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load()
      .catch(() => {
        if (!cancelled) setError("分享状态读取失败，请稍后重试。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const runAction = async (
    action: () => Promise<void>,
    failureMessage: string,
  ) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(failureMessage);
    } finally {
      setBusy(false);
    }
  };

  const createOrOverwrite = (
    visibility: "private" | "public",
    expiry: ExpiryKey,
    allowDownload: boolean,
  ) => runAction(async () => {
    const option = EXPIRY_OPTIONS.find((item) => item.key === expiry)!;
    const result = await api.createShare(resumeId, {
      visibility,
      expires_at: option.expiresAt(),
      allow_download: allowDownload,
    });
    setShare(result.share);
  }, "生成分享链接失败，请稍后重试。");

  const regenerate = () => runAction(async () => {
    if (!share) return;
    const result = await api.createShare(resumeId, {
      visibility: share.share_visibility,
      expires_at: share.share_expires_at ?? null,
      allow_download: share.share_allow_download,
    });
    setShare(result.share);
  }, "重新生成分享链接失败，请稍后重试。");

  const updateConfig = (payload: ResumeShareUpdatePayload) =>
    runAction(async () => {
      const result = await api.updateShare(resumeId, payload);
      setShare(result.share);
    }, "更新链接配置失败，请稍后重试。");

  const updateAllowDownload = async (allowDownload: boolean) => {
    if (!share || busy || allowDownloadPendingRef.current) return;
    const previousShare = share;
    allowDownloadPendingRef.current = true;
    setAllowDownloadPending(true);
    setError(null);
    setShare({ ...share, share_allow_download: allowDownload });
    try {
      const result = await api.updateShare(resumeId, { allow_download: allowDownload });
      setShare(result.share);
    } catch {
      setShare(previousShare);
      setError("更新链接配置失败，请稍后重试。");
    } finally {
      allowDownloadPendingRef.current = false;
      setAllowDownloadPending(false);
    }
  };

  const copyLink = async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(shareUrl(share.share_token));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动复制链接。");
    }
  };

  const updateExpiry = (key: ExpiryKey) => {
    const option = EXPIRY_OPTIONS.find((item) => item.key === key)!;
    void updateConfig({ expires_at: option.expiresAt() });
  };

  const currentExpiry = matchExpiry(share?.share_expires_at ?? null);
  const expired = !!share && isShareExpired(share.share_expires_at);
  const visibilitySummary = share?.share_visibility === "public" ? "公开" : "仅自己";

  return (
    <div
      className="share-panel-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="share-panel"
        data-download-pending={allowDownloadPending || undefined}
        role="dialog"
        aria-modal="true"
        aria-label={`分享「${resumeTitle}」`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="share-panel-head">
          <div className="share-panel-title">
            <h2>分享简历</h2>
          </div>
          <button type="button" className="share-panel-close" aria-label="关闭" onClick={onClose}>
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </header>

        {loading ? (
          <div className="share-panel-loading"><PageLoading label="正在读取分享状态…" scope="panel" /></div>
        ) : error && !share ? (
          <div className="share-panel-body share-panel-empty">
            <p className="share-panel-error">{error}</p>
            <button type="button" className="share-panel-retry" onClick={() => void load()}>
              重试
            </button>
          </div>
        ) : !share ? (
          <div className="share-panel-body share-panel-empty">
            <div className="share-panel-settings">
              <div className="share-panel-setting">
                <span>访问权限</span>
                <Select
                  value={createVisibility}
                  disabled={busy}
                  onValueChange={(value) => setCreateVisibility(value as "private" | "public")}
                >
                  <SelectTrigger
                    className="share-panel-select-trigger"
                    aria-label="访问权限"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="share-panel-select-content">
                    <SelectItem value="public" className="share-panel-select-item">所有人可见</SelectItem>
                    <SelectItem value="private" className="share-panel-select-item">仅自己可见</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="share-panel-setting">
                <span>有效期</span>
                <Select
                  value={createExpiry}
                  disabled={busy}
                  onValueChange={(value) => setCreateExpiry(value as ExpiryKey)}
                >
                  <SelectTrigger
                    className="share-panel-select-trigger"
                    aria-label="有效期"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="share-panel-select-content">
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.key}
                        value={option.key}
                        className="share-panel-select-item"
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="share-panel-setting share-panel-download-setting">
                <span className="share-panel-setting-copy">
                  <strong>允许下载 PDF</strong>
                  <small>关闭后，公开页面不显示下载入口</small>
                </span>
                <button
                  type="button"
                  className={`share-panel-switch${createAllowDownload ? " is-on" : ""}`}
                  role="switch"
                  aria-label="允许下载 PDF"
                  aria-checked={createAllowDownload}
                  disabled={busy}
                  onClick={() => setCreateAllowDownload((value) => !value)}
                >
                  <span />
                </button>
              </div>
            </div>
            <div className="share-panel-create-actions">
              <button
                type="button"
                className="share-panel-primary"
                disabled={busy}
                onClick={() => void createOrOverwrite(createVisibility, createExpiry, createAllowDownload)}
              >
                {busy ? "正在创建…" : "创建分享链接"}
              </button>
            </div>
            {error && <p className="share-panel-error">{error}</p>}
          </div>
        ) : (
          <div className="share-panel-body share-panel-has-link">
            <section className="share-panel-link-section">
              <span className="share-panel-section-label">
                {expired ? "状态说明" : "分享链接"}
              </span>
              <p className={`share-panel-status is-${expired ? "expired" : "available"}`} role="status">
                <span>{expired ? "链接已过期" : "链接可用"}</span>
                <span className="share-panel-status-summary">
                  {expired
                    ? formatShareExpiry(share.share_expires_at, true)
                    : `${visibilitySummary} · ${formatShareExpiry(share.share_expires_at)}`}
                </span>
              </p>
              <span className="share-panel-link-row">
                <span
                  className={`share-panel-link-value${expired ? " is-expired" : ""}`}
                  title={expired ? undefined : shareUrl(share.share_token)}
                >
                  {expired
                    ? "该分享链接已失效，访客将无法继续访问简历"
                    : shareUrl(share.share_token)}
                </span>
                <button
                  type="button"
                  className={`share-panel-copy${expired ? " is-disabled" : ""}`}
                  onClick={() => void copyLink()}
                  disabled={busy || expired}
                >
                  <Copy size={16} strokeWidth={1.8} aria-hidden="true" />
                  {expired ? "不可复制" : copied ? "已复制" : "复制链接"}
                </button>
              </span>
            </section>

            <div className="share-panel-divider" />
            <div className="share-panel-settings">
              <div className="share-panel-setting">
                <span>访问权限</span>
                <Select
                  value={share.share_visibility}
                  disabled={busy || allowDownloadPending}
                  onValueChange={(value) => void updateConfig({
                    visibility: value as "private" | "public",
                  })}
                >
                  <SelectTrigger className="share-panel-select-trigger" aria-label="访问权限">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="share-panel-select-content">
                    <SelectItem value="public" className="share-panel-select-item">所有人可见</SelectItem>
                    <SelectItem value="private" className="share-panel-select-item">仅自己可见</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="share-panel-setting">
                <span>有效期</span>
                <Select
                  value={currentExpiry ?? "custom"}
                  disabled={busy || allowDownloadPending}
                  onValueChange={(value) => {
                    if (value !== "custom") updateExpiry(value as ExpiryKey);
                  }}
                >
                  <SelectTrigger className="share-panel-select-trigger" aria-label="有效期">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="share-panel-select-content">
                    {currentExpiry === null && (
                      <SelectItem value="custom" disabled className="share-panel-select-item">
                        {formatShareExpiry(share.share_expires_at)}
                      </SelectItem>
                    )}
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.key}
                        value={option.key}
                        className="share-panel-select-item"
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="share-panel-setting share-panel-download-setting">
                <span className="share-panel-setting-copy">
                  <strong>允许下载 PDF</strong>
                  <small>
                    {share.share_allow_download
                      ? "关闭后，公开页面不显示下载入口"
                      : "关闭后，任何访问者（包括分享者）均不可下载"}
                  </small>
                </span>
                <button
                  type="button"
                  className={`share-panel-switch${share.share_allow_download ? " is-on" : ""}`}
                  role="switch"
                  aria-label="允许下载 PDF"
                  aria-checked={share.share_allow_download}
                  disabled={busy || allowDownloadPending}
                  onClick={() => void updateAllowDownload(!share.share_allow_download)}
                >
                  <span />
                </button>
              </div>
            </div>

            {error && <p className="share-panel-error">{error}</p>}
            <div className="share-panel-actions">
              <button
                type="button"
                className="share-panel-regenerate"
                disabled={busy || allowDownloadPending}
                onClick={() => setConfirmRegenerate(true)}
              >
                <RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />
                重新生成链接
              </button>
              <button
                type="button"
                className="share-panel-danger"
                disabled={busy || allowDownloadPending}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
                删除链接
              </button>
            </div>
          </div>
        )}
      </section>

      {confirmRegenerate && (
        <ConfirmDialog
          kind="warning"
          title="重新生成分享链接？"
          description={`重新生成后旧链接将立即失效，已转发的旧地址无法再访问。「${resumeTitle}」的分享配置（可见性、有效期与下载权限）会保留。`}
          confirmLabel="确认重新生成"
          busyLabel="正在重新生成…"
          busy={busy}
          onCancel={() => setConfirmRegenerate(false)}
          onConfirm={() => {
            setConfirmRegenerate(false);
            void regenerate();
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          kind="delete"
          title="删除分享链接？"
          description={`删除后旧地址将显示「分享链接已失效」，之后可重新创建。「${resumeTitle}」本身不受影响。`}
          confirmLabel="确认删除"
          busyLabel="正在删除…"
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void runAction(async () => {
              await api.deleteShare(resumeId);
              setCreateVisibility("public");
              setCreateExpiry("forever");
              setCreateAllowDownload(true);
              setShare(null);
            }, "删除分享链接失败，请稍后重试。");
          }}
        />
      )}
    </div>
  );
}
