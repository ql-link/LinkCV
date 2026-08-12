import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, EyeOff, Link2, Save, Share2, Trash2 } from "lucide-react";
import { api, type ResumeShareState } from "../../api/client";
import { ConfirmDialog } from "@/components/ui";

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

/** 像 API key 一样遮蔽链接：保留 token 前后几位，中间打码。 */
function maskShareUrl(url: string) {
  const idx = url.lastIndexOf("/");
  const head = url.slice(0, idx + 1);
  const token = url.slice(idx + 1);
  if (token.length <= 8) return `${head}${token.slice(0, 2)}*****${token.slice(-2)}`;
  return `${head}${token.slice(0, 4)}*****${token.slice(-4)}`;
}

function matchExpiry(expiresAt: string | null): ExpiryKey | null {
  if (!expiresAt) return "forever";
  // 后端返回的 SQLite naive datetime 无时区标记，按 UTC 解析与前端生成的 ISO 对齐
  const time = Date.parse(expiresAt.endsWith("Z") ? expiresAt : `${expiresAt}Z`);
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
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [revealed, setRevealed] = useState(false);
  // 已分享界面的可见性/有效期先本地暂存，用户确认保存后才提交
  const [draftVisibility, setDraftVisibility] = useState<"private" | "public">("public");
  const [draftExpiry, setDraftExpiry] = useState<ExpiryKey | null>(null);

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

  // 链接加载或保存成功后，把暂存值同步为最新服务端状态
  useEffect(() => {
    if (!share) return;
    setDraftVisibility(share.share_visibility);
    setDraftExpiry(matchExpiry(share.share_expires_at));
  }, [share]);

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

  const createOrOverwrite = (visibility: "private" | "public", expiry: ExpiryKey) =>
    runAction(async () => {
      const option = EXPIRY_OPTIONS.find((item) => item.key === expiry)!;
      const result = await api.createShare(resumeId, {
        visibility,
        expires_at: option.expiresAt(),
      });
      setRevealed(false);
      setShare(result.share);
    }, "生成分享链接失败，请稍后重试。");

  const saveConfig = () =>
    runAction(async () => {
      const option = EXPIRY_OPTIONS.find((item) => item.key === draftExpiry);
      const result = await api.updateShare(resumeId, {
        visibility: draftVisibility,
        expires_at: option ? option.expiresAt() : share?.share_expires_at ?? null,
      });
      setShare(result.share);
    }, "保存链接配置失败，请稍后重试。");

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

  const visibilityLabel = (value: "private" | "public") => (value === "public" ? "所有人可见" : "仅自己可见");
  const currentExpiryLabel =
    EXPIRY_OPTIONS.find((option) => option.key === matchExpiry(share?.share_expires_at ?? null))?.label ?? "保持当前";
  const nextExpiryLabel =
    EXPIRY_OPTIONS.find((option) => option.key === draftExpiry)?.label ?? "保持当前";
  const hasChanges =
    !!share &&
    (draftVisibility !== share.share_visibility || draftExpiry !== matchExpiry(share.share_expires_at));

  return (
    <div
      className="share-panel-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        // 仅点击遮罩空白处关闭；避免弹窗内按钮的 mousedown 冒泡误关面板
        if (event.target === event.currentTarget) onClose();
      }}
    >
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
            <button
              type="button"
              className="share-panel-primary"
              disabled={busy}
              onClick={() => setConfirmCreate(true)}
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
                <input
                  readOnly
                  value={revealed ? shareUrl(share.share_token) : maskShareUrl(shareUrl(share.share_token))}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  className="share-panel-copy"
                  onClick={() => setRevealed((value) => !value)}
                  disabled={busy}
                >
                  {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                  {revealed ? "隐藏" : "查看"}
                </button>
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
                  className={draftVisibility === "public" ? "active" : ""}
                  onClick={() => setDraftVisibility("public")}
                  disabled={busy}
                >
                  所有人可见
                </button>
                <button
                  type="button"
                  className={draftVisibility === "private" ? "active" : ""}
                  onClick={() => setDraftVisibility("private")}
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
                    className={draftExpiry === option.key ? "active" : ""}
                    onClick={() => setDraftExpiry(option.key)}
                    disabled={busy}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {share.share_expires_at &&
                Date.parse(
                  share.share_expires_at.endsWith("Z")
                    ? share.share_expires_at
                    : `${share.share_expires_at}Z`,
                ) < Date.now() && (
                  <p className="share-panel-expiry">
                    <span className="share-panel-expired">已过期，切换有效期即可恢复</span>
                  </p>
                )}
            </div>

            {hasChanges && (
              <p className="share-panel-dirty">
                当前配置：{visibilityLabel(share!.share_visibility)} · {currentExpiryLabel}，修改后未保存
              </p>
            )}

            <div className="share-panel-actions">
              <button
                type="button"
                className="share-panel-save"
                disabled={busy}
                onClick={() => setConfirmSave(true)}
              >
                <Save size={14} />
                保存链接配置
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

      {confirmCreate && (
        <ConfirmDialog
          kind="create"
          title="创建分享链接？"
          description={`「${resumeTitle}」将生成一个${
            createVisibility === "public" ? "所有人可见" : "仅自己可见"
          }、有效期${
            EXPIRY_OPTIONS.find((option) => option.key === createExpiry)!.label
          }的分享链接。`}
          confirmLabel="确认创建"
          busyLabel="正在创建…"
          busy={busy}
          onCancel={() => setConfirmCreate(false)}
          onConfirm={() => {
            setConfirmCreate(false);
            void createOrOverwrite(createVisibility, createExpiry);
          }}
        />
      )}
      {confirmSave && (
        <ConfirmDialog
          kind="save"
          title="保存链接配置？"
          description={
            <>
              当前配置：{visibilityLabel(share!.share_visibility)} · {currentExpiryLabel}
              <br />
              将更新为：{visibilityLabel(draftVisibility)} · {nextExpiryLabel}
            </>
          }
          confirmLabel="确认保存"
          busyLabel="正在保存…"
          busy={busy}
          onCancel={() => setConfirmSave(false)}
          onConfirm={() => {
            setConfirmSave(false);
            void saveConfig();
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
            }, "删除分享链接失败，请稍后重试。");
          }}
        />
      )}
    </div>
  );
}
