import { t, useLocale } from "@/i18n";
import { MotionPresence } from "@/components/ui/motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ResumeShareState, type ResumeShareUpdatePayload } from "../../api/client";
import { copyText } from "../../utils/clipboard";
import { Icon } from "../../v3/Icon";
import { ConfirmDialog, Dialog, Segmented, Toggle } from "../../v3/primitives";
import { ShareArt } from "./homeArt";
import { useStableCallback } from "./useStableCallback";
import "./home-v3.css";

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

// 有效期文案：Figma 写法「有效至 2026-10-27 18:00」
function formatShareExpiry(expiresAt: string | null, expired = false) {
  if (!expiresAt) return t("永久有效");
  const time = parseShareExpiry(expiresAt);
  if (time === null) return t("到期时间不可用");
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  const label = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return expired ? t("已于 {value0} 过期", { value0: label }) : t("有效至 {value0}", { value0: label });
}

type SharePanelProps = {
  resumeId: string;
  resumeTitle: string;
  onClose: () => void;
};

const EXPIRY_OPTIONS = [
  { key: "7d", get label() { return t("7 天"); }, expiresAt: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
  { key: "1m", get label() { return t("30 天"); }, expiresAt: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
  { key: "forever", get label() { return t("永久"); }, expiresAt: () => null },
] as const;

type ExpiryKey = (typeof EXPIRY_OPTIONS)[number]["key"];
type Visibility = "private" | "public";

const VISIBILITY_OPTIONS: Array<{ value: Visibility; label: string }> = [
  { value: "public", get label() { return t("公开"); } },
  { value: "private", get label() { return t("仅自己"); } },
];

function shareUrl(token: string) {
  return `${window.location.origin}/share/${token}`;
}

function matchExpiry(expiresAt: string | null): ExpiryKey | null {
  if (!expiresAt) return "forever";
  const time = parseShareExpiry(expiresAt);
  if (time === null) return null;
  for (const option of EXPIRY_OPTIONS) {
    if (option.key === "forever") continue;
    if (Math.abs(time - Date.parse(option.expiresAt() as string)) < 60 * 60 * 1000) return option.key;
  }
  return null;
}

// 设置卡里的一行：左侧标题 + 说明，右侧控件
function SettingRow({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  useLocale();
  return (
    <div className="v3-grow hv3-share-row">
      <div className="v3-grow-copy">
        <strong>{title}</strong>
        <small>{hint}</small>
      </div>
      <div className="v3-grow-right">{children}</div>
    </div>
  );
}

// 02.1d 分享简历（520 宽）：插图 → 链接栏（唯一黑按钮「复制链接」）→ 状态 → 设置卡 → 底部重新生成 / 删除 + 完成
export function SharePanel({ resumeId, resumeTitle, onClose }: SharePanelProps) {
  useLocale();
  const close = useStableCallback(onClose);
  const [share, setShare] = useState<ResumeShareState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createVisibility, setCreateVisibility] = useState<Visibility>("public");
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
        if (!cancelled) setError(t("分享状态读取失败，请稍后重试。"));
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

  const createShare = () => runAction(async () => {
    const option = EXPIRY_OPTIONS.find((item) => item.key === createExpiry)!;
    const result = await api.createShare(resumeId, {
      visibility: createVisibility,
      expires_at: option.expiresAt(),
      allow_download: createAllowDownload,
    });
    setShare(result.share);
  }, t("生成分享链接失败，请稍后重试。"));

  // 重新生成：保留可见性与下载权限；未过期保留原到期时间，已过期按原有效时长顺延（推算不出时默认 7 天）
  const regenerate = () => {
    if (!share) return;
    const now = Date.now();
    const expiresAt = parseShareExpiry(share.share_expires_at);
    let nextExpiry = share.share_expires_at;
    if (expiresAt !== null && expiresAt <= now) {
      const createdAt = parseShareExpiry(share.share_created_at);
      nextExpiry = createdAt !== null && createdAt < expiresAt
        ? new Date(now + expiresAt - createdAt).toISOString()
        : EXPIRY_OPTIONS[0].expiresAt();
    }
    void runAction(async () => {
      const result = await api.createShare(resumeId, {
        visibility: share.share_visibility,
        expires_at: nextExpiry,
        allow_download: share.share_allow_download,
      });
      setShare(result.share);
    }, t("重新生成分享链接失败，请稍后重试。"));
  };

  const updateConfig = (payload: ResumeShareUpdatePayload) =>
    runAction(async () => {
      const result = await api.updateShare(resumeId, payload);
      setShare(result.share);
    }, t("更新链接配置失败，请稍后重试。"));

  // 下载开关先乐观更新，失败回滚
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
      setError(t("更新链接配置失败，请稍后重试。"));
    } finally {
      allowDownloadPendingRef.current = false;
      setAllowDownloadPending(false);
    }
  };

  const copyLink = async () => {
    if (!share) return;
    setError(null);
    setCopied(false);
    try {
      await copyText(shareUrl(share.share_token));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("复制失败，请手动复制链接。"));
    }
  };

  const currentExpiry = matchExpiry(share?.share_expires_at ?? null);
  const expired = !!share && isShareExpired(share.share_expires_at);
  const originalExpiresAt = parseShareExpiry(share?.share_expires_at ?? null);
  const originalCreatedAt = parseShareExpiry(share?.share_created_at ?? null);
  const canRenewOriginalDuration = originalExpiresAt !== null && originalCreatedAt !== null && originalCreatedAt < originalExpiresAt;
  const regenerationExpiryDescription = !expired
    ? t("现有到期时间会保留。")
    : canRenewOriginalDuration
      ? t("新链接按原有效时长重新计算到期时间。")
      : t("原有效时长无法确定，新链接默认有效 7 天。");
  const locked = busy || allowDownloadPending;
  const visibility = share?.share_visibility ?? createVisibility;
  const allowDownload = share ? share.share_allow_download : createAllowDownload;
  const confirmOpen = confirmRegenerate || confirmDelete;

  return (
    <>
      <Dialog
        width={520}
        label={t("分享「{value0}」", { value0: resumeTitle })}
        onClose={close}
        closable={!confirmOpen}
        className="hv3-share"
      >
        <div className="v3-dialog-body" data-download-pending={allowDownloadPending || undefined}>
          <h2 className="v3-dialog-title">{t("分享简历")}</h2>
          <p className="v3-dialog-sub hv3-share-sub">{t("为「")}{resumeTitle}{t("」生成只读链接，对方不用登录就能查看。")}</p>
          <div className="v3-stage has-dots hv3-share-stage"><ShareArt visibility={visibility} token={share?.share_token} /></div>

          {loading ? (
            <div className="hv3-share-loading" role="status" aria-label={t("正在读取分享状态…")}>{t("正在读取分享状态…")}</div>
          ) : error && !share && !busy && !createPending(error) ? (
            <div className="hv3-share-loading">
              <p className="hv3-share-error" role="alert">{error}</p>
              <button type="button" className="v3-btn v3-btn-ghost" onClick={() => void load().catch(() => setError(t("分享状态读取失败，请稍后重试。")))}>{t("重试")}</button>
            </div>
          ) : (
            <>
              {share && (
                <>
                  <div className={`hv3-share-link${expired ? " is-expired" : ""}`}>
                    <Icon name="link" size={14} />
                    <span className="hv3-share-url v3-num" title={expired ? undefined : shareUrl(share.share_token)}>
                      {expired ? t("该分享链接已失效，访客将无法继续访问简历") : shareUrl(share.share_token)}
                    </span>
                    <button type="button" className="v3-btn v3-btn-dark hv3-share-copy" onClick={() => void copyLink()} disabled={busy || expired}>
                      {expired ? t("不可复制") : copied ? t("已复制") : t("复制链接")}
                    </button>
                  </div>
                  <p className={`hv3-share-status${expired ? " is-expired" : ""}`} role="status">
                    <span className="hv3-share-dot" />
                    <span className="hv3-share-status-label">{expired ? t("链接已过期") : t("链接可用")}</span>
                    <span className="hv3-share-status-time v3-num">{formatShareExpiry(share.share_expires_at, expired)}</span>
                  </p>
                </>
              )}

              <div className="v3-gcard hv3-share-settings">
                <SettingRow title={t("谁可以查看")} hint={visibility === "public" ? t("公开后，拿到链接的人都能打开") : t("仅自己登录后可以打开")}>
                  <Segmented<Visibility>
                    label={t("访问权限")}
                    value={visibility}
                    options={VISIBILITY_OPTIONS}
                    onChange={(value) => {
                      if (locked) return;
                      if (share) {
                        if (value !== share.share_visibility) void updateConfig({ visibility: value });
                      } else setCreateVisibility(value);
                    }}
                  />
                </SettingRow>
                <SettingRow title={t("链接有效期")} hint={t("到期后链接自动失效，可以重新生成")}>
                  <Segmented<ExpiryKey | "custom">
                    label={t("有效期")}
                    value={share ? currentExpiry ?? "custom" : createExpiry}
                    options={EXPIRY_OPTIONS.map((option) => ({ value: option.key, label: option.label }))}
                    onChange={(value) => {
                      if (locked || value === "custom") return;
                      const option = EXPIRY_OPTIONS.find((item) => item.key === value)!;
                      if (share) void updateConfig({ expires_at: option.expiresAt() });
                      else setCreateExpiry(option.key);
                    }}
                  />
                </SettingRow>
                <SettingRow
                  title={t("允许下载 PDF")}
                  hint={allowDownload ? t("关闭后，公开页面不显示下载入口") : t("关闭后，任何访问者（包括分享者）均不可下载")}
                >
                  <Toggle
                    label={t("允许下载 PDF")}
                    checked={allowDownload}
                    disabled={locked}
                    onChange={(next) => {
                      if (share) void updateAllowDownload(next);
                      else setCreateAllowDownload(next);
                    }}
                  />
                </SettingRow>
              </div>
              {error && <p className="hv3-share-error" role="alert">{error}</p>}
            </>
          )}
        </div>

        <div className="v3-dialog-foot hv3-foot">
          <div className="v3-dialog-foot-left">
            {share && (
              <>
                <button type="button" className="v3-link hv3-share-regen" disabled={locked} onClick={() => setConfirmRegenerate(true)}>
                  <Icon name="refresh" size={13} />{t("重新生成链接")}</button>
                <button type="button" className="v3-link hv3-share-delete" disabled={locked} onClick={() => setConfirmDelete(true)}>{t("删除链接")}</button>
              </>
            )}
          </div>
          {!loading && !share ? (
            <>
              <button type="button" className="v3-btn v3-btn-ghost hv3-foot-cancel" onClick={onClose}>{t("取消")}</button>
              <button type="button" className="v3-btn v3-btn-dark" disabled={busy} onClick={() => void createShare()}>
                {busy ? t("正在创建…") : t("创建分享链接")}
              </button>
            </>
          ) : (
            <button type="button" className="v3-btn v3-btn-ghost hv3-share-done" onClick={onClose}>{t("完成")}</button>
          )}
        </div>
      </Dialog>

      <MotionPresence>{confirmRegenerate && (
        <ConfirmDialog
          danger={false}
          title={t("重新生成分享链接？")}
          description={t("重新生成后旧链接将立即失效，已转发的旧地址无法再访问。「{value0}」的可见性与下载权限会保留。{value1}", { value0: resumeTitle, value1: regenerationExpiryDescription })}
          confirmLabel={t("确认重新生成")}
          busyLabel={t("正在重新生成…")}
          busy={busy}
          onCancel={() => setConfirmRegenerate(false)}
          onConfirm={() => {
            setConfirmRegenerate(false);
            void regenerate();
          }}
        />
      )}</MotionPresence>
      <MotionPresence>{confirmDelete && (
        <ConfirmDialog
          title={t("删除分享链接？")}
          description={t("删除后旧地址将显示「分享链接已失效」，之后可重新创建。「{value0}」本身不受影响。", { value0: resumeTitle })}
          confirmLabel={t("确认删除")}
          busyLabel={t("正在删除…")}
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
            }, t("删除分享链接失败，请稍后重试。"));
          }}
        />
      )}</MotionPresence>
    </>
  );
}

// 只有「读取失败」才进入重试态；创建 / 删除失败仍留在设置界面并显示错误
function createPending(error: string) {
  return error !== t("分享状态读取失败，请稍后重试。");
}
