import { useCallback, useEffect, useState } from "react";
import { api, type ResumeShareState, type ResumeShareUpdatePayload } from "../../api/client";
import { ConfirmDialog, FeedbackNotice, PageLoading } from "@/components/ui";

function parseShareExpiry(expiresAt: string | null) {
  if (!expiresAt) return null;
  const time = Date.parse(expiresAt.endsWith("Z") ? expiresAt : `${expiresAt}Z`);
  return Number.isFinite(time) ? time : null;
}

function isShareExpired(expiresAt: string | null) {
  const time = parseShareExpiry(expiresAt);
  return time !== null && time < Date.now();
}

function formatShareExpiry(expiresAt: string | null) {
  if (!expiresAt) return "长期有效";
  const time = parseShareExpiry(expiresAt);
  if (time === null) return "到期时间不可用";
  return `有效至 ${new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(time))}`;
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
    label: "一个月",
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
  const [success, setSuccess] = useState<string | null>(null);
  const [createVisibility, setCreateVisibility] = useState<"private" | "public">("public");
  const [createExpiry, setCreateExpiry] = useState<ExpiryKey>("forever");
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
    successMessage?: string,
  ) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      if (successMessage) setSuccess(successMessage);
    } catch {
      setError(failureMessage);
    } finally {
      setBusy(false);
    }
  };

  const createOrOverwrite = (visibility: "private" | "public", expiry: ExpiryKey) =>
    runAction(async () => {
      const option = EXPIRY_OPTIONS.find((item) => item.key === expiry)!;
      const result = await api.createShare(resumeId, {
        visibility,
        expires_at: option.expiresAt(),
      });
      setShare(result.share);
    }, "生成分享链接失败，请稍后重试。", "分享链接已创建。");

  const regenerate = () =>
    runAction(async () => {
      if (!share) return;
      const result = await api.createShare(resumeId, {
        visibility: share.share_visibility,
        expires_at: share.share_expires_at ?? null,
      });
      setShare(result.share);
    }, "重新生成分享链接失败，请稍后重试。", "分享链接已重新生成。");

  const updateConfig = (payload: ResumeShareUpdatePayload, successMessage: string) =>
    runAction(async () => {
      const result = await api.updateShare(resumeId, payload);
      setShare(result.share);
    }, "更新链接配置失败，请稍后重试。", successMessage);

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

  const visibilityLabel = (value: "private" | "public") =>
    value === "public" ? "所有人可见" : "仅自己可见";
  const currentExpiry = matchExpiry(share?.share_expires_at ?? null);
  const expired = !!share && isShareExpired(share.share_expires_at);

  return (
    <div
      className="share-panel-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {success && (
        <FeedbackNotice kind="success" placement="floating" onDismiss={() => setSuccess(null)}>
          {success}
        </FeedbackNotice>
      )}
      <section
        className="share-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`分享「${resumeTitle}」`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="share-panel-head">
          <div className="share-panel-title">
            <h2>分享简历</h2>
            <p className="share-panel-doc">{resumeTitle}</p>
            <p className="share-panel-sub">分享内容会同步展示最近一次自动保存成功的草稿。</p>
          </div>
          <button type="button" className="share-panel-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        {loading ? (
          <PageLoading label="正在读取分享状态…" scope="panel" />
        ) : error && !share ? (
          <div className="share-panel-body">
            <p className="share-panel-error">{error}</p>
            <button type="button" className="share-panel-retry" onClick={() => void load()}>
              重试
            </button>
          </div>
        ) : !share ? (
          <div className="share-panel-body">
            <div className="share-panel-field">
              <label>谁可以看</label>
              <div className="share-panel-visibility">
                <button
                  type="button"
                  className={createVisibility === "public" ? "active" : ""}
                  onClick={() => setCreateVisibility("public")}
                  disabled={busy}
                >
                  所有人可见
                </button>
                <button
                  type="button"
                  className={createVisibility === "private" ? "active" : ""}
                  onClick={() => setCreateVisibility("private")}
                  disabled={busy}
                >
                  仅自己可见
                </button>
              </div>
            </div>
            <div className="share-panel-field">
              <label>有效期</label>
              <div className="share-panel-visibility">
                {EXPIRY_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={createExpiry === option.key ? "active" : ""}
                    onClick={() => setCreateExpiry(option.key)}
                    disabled={busy}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="share-panel-footer">
              <button
                type="button"
                className="share-panel-primary"
                disabled={busy}
                onClick={() => void createOrOverwrite(createVisibility, createExpiry)}
              >
                {busy ? "正在创建…" : "创建分享链接"}
              </button>
            </div>
            {error && <p className="share-panel-error">{error}</p>}
          </div>
        ) : (
          <div className="share-panel-body">
            <p className={`share-panel-status is-${expired ? "expired" : "available"}`} role="status">
              {expired ? "链接已过期，选择新的有效期即可恢复" : "链接当前可用"}
              <span className="share-panel-status-summary">
                {visibilityLabel(share.share_visibility)} · {formatShareExpiry(share.share_expires_at)}
              </span>
            </p>
            <div className="share-panel-field">
              <label>分享链接</label>
              <div className="share-panel-link-row">
                <input
                  readOnly
                  value={shareUrl(share.share_token)}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button type="button" className="share-panel-copy" onClick={() => void copyLink()} disabled={busy}>
                  {copied ? "已复制" : "复制链接"}
                </button>
              </div>
            </div>

            <div className="share-panel-field">
              <label>谁可以查看</label>
              <div className="share-panel-visibility">
                <button
                  type="button"
                  className={share.share_visibility === "public" ? "active" : ""}
                  onClick={() => void updateConfig({ visibility: "public" }, "已设为所有人可见。")}
                  disabled={busy || share.share_visibility === "public"}
                >
                  所有人可见
                </button>
                <button
                  type="button"
                  className={share.share_visibility === "private" ? "active" : ""}
                  onClick={() => void updateConfig({ visibility: "private" }, "已设为仅自己可见。")}
                  disabled={busy || share.share_visibility === "private"}
                >
                  仅自己可见
                </button>
              </div>
            </div>

            <div className="share-panel-field">
              <label>有效期</label>
              <div className="share-panel-visibility">
                {EXPIRY_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={currentExpiry === option.key ? "active" : ""}
                    onClick={() => void updateConfig(
                      { expires_at: option.expiresAt() },
                      `有效期已更新为${option.label}。`,
                    )}
                    disabled={busy || currentExpiry === option.key}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="share-panel-expiry">{formatShareExpiry(share.share_expires_at)}</p>
            </div>

            <div className="share-panel-danger-zone">
              <div>
                <strong>链接管理</strong>
                <span>重新生成会立即使已经转发的旧地址失效。</span>
              </div>
              <div className="share-panel-actions">
                <button
                  type="button"
                  className="share-panel-regenerate"
                  disabled={busy}
                  onClick={() => setConfirmRegenerate(true)}
                >
                  重新生成链接
                </button>
                <button
                  type="button"
                  className="share-panel-danger"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  删除链接
                </button>
              </div>
            </div>
            {error && <p className="share-panel-error">{error}</p>}
          </div>
        )}
      </section>

      {confirmRegenerate && (
        <ConfirmDialog
          kind="warning"
          title="重新生成分享链接？"
          description={`重新生成后旧链接将立即失效，已转发的旧地址无法再访问。「${resumeTitle}」的分享配置（可见性与有效期）会保留。`}
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
              setShare(null);
            }, "删除分享链接失败，请稍后重试。", "分享链接已删除。");
          }}
        />
      )}
    </div>
  );
}
