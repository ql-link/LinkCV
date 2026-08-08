import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, RefreshCw, Share2, Trash2 } from "lucide-react";
import { api, type ResumeShareState } from "../../api/client";
import { ConfirmDialog } from "../../components/ConfirmDialog";

type SharePanelProps = {
  resumeId: string;
  resumeTitle: string;
  onClose: () => void;
};

function shareUrl(token: string) {
  return `${window.location.origin}/share/${token}`;
}

function formatExpiry(value: string | null) {
  if (!value) return "长期有效";
  return new Date(value).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function SharePanel({ resumeId, resumeTitle, onClose }: SharePanelProps) {
  const [share, setShare] = useState<ResumeShareState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
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

  const runAction = async (action: () => Promise<void>, failureMessage: string) => {
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

  const createOrOverwrite = () =>
    runAction(async () => {
      const result = await api.createShare(resumeId);
      setShare(result.share);
    }, "生成分享链接失败，请稍后重试。");

  const updateVisibility = (visibility: "private" | "public") =>
    runAction(async () => {
      const result = await api.updateShare(resumeId, { visibility });
      setShare(result.share);
    }, "修改可见性失败，请稍后重试。");

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

  return (
    <div className="share-panel-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="share-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`分享「${resumeTitle}」`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="share-panel-head">
          <h2>
            <Share2 size={16} />
            分享简历
          </h2>
          <button type="button" className="share-panel-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        {loading ? (
          <p className="share-panel-empty">正在读取分享状态…</p>
        ) : error && !share ? (
          <div className="share-panel-body">
            <p className="share-panel-error">{error}</p>
            <button type="button" className="share-panel-retry" onClick={() => void load()}>
              重试
            </button>
          </div>
        ) : !share ? (
          <div className="share-panel-body">
            <p className="share-panel-hint">
              生成链接后，招聘方可直接打开查看这份简历的最新正式版本。分享内容只读，编辑草稿不会影响已分享内容。
            </p>
            <button
              type="button"
              className="share-panel-primary"
              disabled={busy}
              onClick={() => void createOrOverwrite()}
            >
              <Link2 size={14} />
              创建分享链接
            </button>
            {error && <p className="share-panel-error">{error}</p>}
          </div>
        ) : (
          <div className="share-panel-body">
            <div className="share-panel-field">
              <label>分享链接</label>
              <div className="share-panel-link-row">
                <input readOnly value={shareUrl(share.share_token)} onFocus={(event) => event.currentTarget.select()} />
                <button type="button" className="share-panel-copy" onClick={() => void copyLink()} disabled={busy}>
                  <Copy size={14} />
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
            </div>

            <div className="share-panel-field">
              <label>谁可以查看</label>
              <div className="share-panel-visibility">
                <button
                  type="button"
                  className={share.share_visibility === "public" ? "active" : ""}
                  onClick={() => updateVisibility("public")}
                  disabled={busy}
                >
                  所有人可见
                </button>
                <button
                  type="button"
                  className={share.share_visibility === "private" ? "active" : ""}
                  onClick={() => updateVisibility("private")}
                  disabled={busy}
                >
                  仅自己可见
                </button>
              </div>
            </div>

            <div className="share-panel-field">
              <label>有效期</label>
              <p className="share-panel-expiry">
                {formatExpiry(share.share_expires_at)}
                {share.share_expires_at && new Date(share.share_expires_at).getTime() < Date.now() && (
                  <span className="share-panel-expired">已过期，可续期恢复</span>
                )}
              </p>
            </div>

            <div className="share-panel-actions">
              <button
                type="button"
                className="share-panel-secondary"
                disabled={busy}
                onClick={() => setConfirmOverwrite(true)}
              >
                <RefreshCw size={14} />
                覆盖链接
              </button>
              <button
                type="button"
                className="share-panel-danger"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} />
                删除链接
              </button>
            </div>
            {error && <p className="share-panel-error">{error}</p>}
          </div>
        )}
      </section>

      {confirmOverwrite && (
        <ConfirmDialog
          kind="warning"
          title="覆盖当前分享链接？"
          description={`旧链接将立即失效，生成一个全新的链接。已发给别人的旧地址将无法再访问「${resumeTitle}」。`}
          confirmLabel="覆盖并生成新链接"
          busyLabel="正在生成…"
          busy={busy}
          onCancel={() => setConfirmOverwrite(false)}
          onConfirm={() => {
            setConfirmOverwrite(false);
            void createOrOverwrite();
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
              setShare(null);
            }, "删除分享链接失败，请稍后重试。");
          }}
        />
      )}
    </div>
  );
}
