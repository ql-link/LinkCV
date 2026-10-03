import { MotionPresence } from "@/components/ui/motion";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { Reveal, SkeletonCards } from "@/v3/skeletons";
import { readPageCache, updatePageCache, useRevalidateOnFocus, writePageCache } from "@/v3/pageCache";
import { api, AccountProfile, UserProfile, type AccountPreferences } from "../../api/client";
import { navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";
import { Icon, type V3IconName } from "../../v3/Icon";
import { Avatar, Dialog, Toast, PageEyebrow, Select } from "../../v3/primitives";
import "./account.css";
import { ChangeEmailArt, ChangePasswordArt, DeleteAccountArt, LogoutArt } from "./accountArt";
import { accountErrorMessage, MAX_NICKNAME_LENGTH } from "./accountErrors";
import {
  AVATAR_CROP_MAX_ZOOM,
  AVATAR_CROP_MIN_ZOOM,
  AVATAR_CROP_VIEWPORT_SIZE,
  AVATAR_CROP_WINDOW_SIZE,
  clampAvatarCropDraft,
  createAvatarCropDataUrl,
  getAvatarCropLayout,
  readAvatarImage,
  type AvatarCropDraft,
} from "./avatarCrop";
import { UserProfilePanel } from "./UserProfilePanel";

import { formatDate, setLocale, useLocale, type Locale, t } from "../../i18n";
import { setLocaleWithTransition } from "../../i18n/transition";
import { saveDeletionReceipt } from "./AccountDeletionPage";
const ACCOUNT_CACHE_KEY = "account-profile";
export { accountErrorMessage } from "./accountErrors";
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
const CROP_SCALE = 232 / AVATAR_CROP_VIEWPORT_SIZE;
type ToastState = { kind: "success" | "error" | "warn"; title: string; message?: string } | null;
type DialogKind = "profile" | "email" | "password" | "logout" | "delete" | "avatarPreview" | null;
type AvatarDrag = { pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number };

export function AccountPage() {
  const locale = useLocale();
  const syncProfile = useResumeStore((state) => state.syncProfile);
  const logout = useResumeStore((state) => state.logout);
  const [profile, setProfile] = useState<AccountProfile | null>(() => readPageCache<AccountProfile>(ACCOUNT_CACHE_KEY)?.value ?? null);
  const [loading, setLoading] = useState(() => !readPageCache(ACCOUNT_CACHE_KEY));
  const [loadFailed, setLoadFailed] = useState(false);
  const [preferences, setPreferences] = useState<AccountPreferences | null>(null);
  const [preferencesFailed, setPreferencesFailed] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = readPageCache<AccountProfile>(ACCOUNT_CACHE_KEY);
    if (!cached?.fresh) void api.getAccountProfile().then((data) => {
      if (!cancelled) { setProfile(data); writePageCache(ACCOUNT_CACHE_KEY, data); syncProfile(data.user); }
    }).catch(() => { if (!cancelled && !cached) setLoadFailed(true); }).finally(() => { if (!cancelled) setLoading(false); });
    void api.getAccountPreferences().then((data) => {
      if (!cancelled) { setPreferences(data); setLocale(data.locale); }
    }).catch(() => { if (!cancelled) setPreferencesFailed(true); });
    return () => { cancelled = true; };
  }, [syncProfile]);
  useRevalidateOnFocus(() => {
    void api.getAccountProfile().then((data) => { setProfile(data); writePageCache(ACCOUNT_CACHE_KEY, data); syncProfile(data.user); }).catch(() => undefined);
  });
  useEffect(() => { if (profile) updatePageCache(ACCOUNT_CACHE_KEY, profile); }, [profile]);
  const applyUserUpdate = (user: UserProfile) => { syncProfile(user); setProfile((current) => current ? { ...current, user } : current); };
  const savePreference = async (payload: Pick<AccountPreferences, "locale">) => {
    if (savingPreference) return;
    setSavingPreference(true);
    try {
      const data = await api.updateAccountPreferences(payload);
      setPreferences(data);
      await setLocaleWithTransition(data.locale);
      setToast({ kind: "success", title: t("偏好已保存") });
    } catch (error) { setToast({ kind: "error", title: accountErrorMessage(error, t("偏好保存失败，请重试。")) }); }
    finally { setSavingPreference(false); }
  };
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await logout(); navigateTo("/", { replace: true }); }
    catch { setToast({ kind: "error", title: t("退出失败"), message: t("退出登录失败，请稍后重试。") }); setLoggingOut(false); }
  };
  const user = profile?.user;
  const initial = [...(user?.nickname.trim() || t("我"))][0];
  return (
    <div className="acc-page">
      <PageEyebrow segments={["ACCOUNT", profile?.capabilities.auth_mode === "password" ? user?.email : profile?.capabilities.auth_mode === "wechat" ? t("微信登录") : null]} />
      <h1 className="v3-page-title" data-locale-motion>{t("账号")}</h1>
      <p className="v3-page-sub acc-sub" data-locale-motion>{t("管理个人资料、登录安全与偏好设置。")}</p>
      <Reveal loading={loading} placeholder={<SkeletonCards cards={[92, 168, 132]} label={t("正在加载个人资料…")} className="acc-loading" />}>
        {!loading && loadFailed && !profile && <section className="v3-empty is-error acc-load-error" role="alert"><h3>{t("暂时无法读取个人资料")}</h3><p>{t("请检查网络连接后重新加载。")}</p><button type="button" className="v3-btn" onClick={() => window.location.reload()}>{t("重新加载")}</button></section>}
        {user && profile && <div>
          {inlineError && <div className="acc-inline-error" role="alert"><strong>{t("保存失败")}</strong><span>{inlineError}</span><button type="button" aria-label={t("关闭提示")} onClick={() => setInlineError(null)}><Icon name="x" size={12} /></button></div>}
          <section className="acc-hero" aria-label={t("个人资料摘要")}>
            <button type="button" className="acc-hero-avatar" aria-label={user.avatar_url ? t("查看头像原图") : t("头像预览不可用")} disabled={!user.avatar_url} onClick={() => setDialog("avatarPreview")}><Avatar name={user.nickname} src={user.avatar_url} size={56} /></button>
            <div className="acc-hero-copy"><div className="acc-hero-name"><h2>{user.nickname}</h2></div><p className="acc-hero-meta" data-locale-motion>{t("注册于")} {formatDate(user.registered_at)}</p></div>
            <button type="button" className="v3-btn v3-btn-ghost acc-hero-edit" onClick={() => { setInlineError(null); setDialog("profile"); }}><span data-locale-motion>{t("编辑资料")}</span></button>
          </section>
          <Section title={t("账号与安全")} desc={t("管理登录方式与联系信息。")}>
            {profile.capabilities.auth_mode === "password" && <>
              <Row label={t("登录邮箱")} value={user.email ?? <span data-locale-motion>{t("未设置")}</span>} />
              {profile.capabilities.can_change_password && <Row label={t("登录密码")} value={<span data-locale-motion>{t("修改后所有设备需要重新登录")}</span>}><RowLink label={t("修改")} onClick={() => setDialog("password")} /></Row>}
            </>}
            {profile.capabilities.auth_mode === "wechat" && <Row label={t("登录方式")} value={<span data-locale-motion>{t("微信登录")}</span>} />}
            <Row label={t("联系邮箱")} value={user.contact_email ?? <span data-locale-motion>{t("未设置")}</span>}><RowLink label={user.contact_email ? t("修改") : t("设置")} onClick={() => setDialog("email")} /></Row>
          </Section>
          <Section title={t("求职资料")} desc={t("由你选择后供 AI 参考，不会自动修改简历。")}><UserProfilePanel /></Section>
          <Section title={t("偏好")} desc={t("界面显示偏好。")}>
            {preferencesFailed && <p role="alert">{t("偏好读取失败，请重新加载后重试。")} <button type="button" className="v3-link" onClick={() => { void api.getAccountPreferences().then((data) => { setPreferences(data); setPreferencesFailed(false); setLocale(data.locale); }).catch(() => setPreferencesFailed(true)); }}>{t("重试")}</button></p>}
            <Row label={t("界面语言")}>
              <Select<Locale>
                className="acc-language-select"
                label={t("界面语言")}
                size="sm"
                value={locale}
                disabled={!preferences || savingPreference}
                options={[{ value: "zh-CN", label: "简体中文" }, { value: "en-US", label: "English" }]}
                onChange={(nextLocale) => void savePreference({ locale: nextLocale })}
              />
            </Row>
          </Section>
          <Section title={t("退出与注销")} desc={t("注销后个人数据会被永久清理，无法恢复。")}>
            <Row label={t("退出登录")} value={t(profile.current_session.device_label)}><button type="button" className="v3-btn v3-btn-ghost is-sm acc-row-btn" onClick={() => setDialog("logout")}><span data-locale-motion>{t("退出")}</span></button></Row>
            {profile.capabilities.can_delete_account && <Row label={t("注销账号")} value={<span data-locale-motion>{t("永久删除账号和个人数据")}</span>}><button type="button" className="acc-row-danger" onClick={() => setDialog("delete")}><span data-locale-motion>{t("注销账号")}</span></button></Row>}
          </Section>
          <MotionPresence>{dialog === "profile" && <EditProfileDialog user={user} onClose={() => setDialog(null)} onUserUpdate={applyUserUpdate} onError={setInlineError} onSaved={(message) => { setDialog(null); setInlineError(null); setToast({ kind: "success", title: message }); }} onNotice={(title) => setToast({ kind: "error", title })} />}</MotionPresence>
          <MotionPresence>{dialog === "email" && <ChangeEmailDialog email={user.contact_email} onClose={() => setDialog(null)} onSaved={(email) => { applyUserUpdate({ ...user, contact_email: email }); setDialog(null); setToast({ kind: "success", title: t("联系邮箱已保存") }); }} />}</MotionPresence>
          <MotionPresence>{dialog === "password" && profile.capabilities.can_change_password && <ChangePasswordDialog onClose={() => setDialog(null)} />}</MotionPresence>
          <MotionPresence>{dialog === "logout" && <CenterConfirm label={t("确认退出登录")} title={t("确认退出登录？")} desc={t("退出后需要重新登录。")} art={<LogoutArt initial={initial} />} impacts={[{ icon: "logout", text: profile.current_session.device_label }, { icon: "check", text: t("其他设备上的登录不受影响") }]} confirmLabel={loggingOut ? t("正在退出…") : t("退出登录")} busy={loggingOut} onClose={() => setDialog(null)} onConfirm={() => void handleLogout()} />}</MotionPresence>
          <MotionPresence>{dialog === "delete" && profile.capabilities.can_delete_account && profile.capabilities.deletion_confirmation_method && <DeleteAccountDialog initial={initial} resumeCount={profile.resume_count} method={profile.capabilities.deletion_confirmation_method} onClose={() => setDialog(null)} />}</MotionPresence>
          <MotionPresence>{dialog === "avatarPreview" && user.avatar_url && <Dialog width={420} label={t("查看头像原图")} onClose={() => setDialog(null)} className="acc-avatar-preview"><img className="acc-avatar-preview-image" src={user.avatar_url} alt={t("头像原图")} /></Dialog>}</MotionPresence>
        </div>}
      </Reveal>
      <MotionPresence>{toast && <Toast kind={toast.kind} title={toast.title} message={toast.message} onDismiss={() => setToast(null)} />}</MotionPresence>
    </div>
  );
}

/* ───────────── 区块与设置行 ───────────── */

function Section({ title, desc, children, className = "" }: { title: string; desc: string; children: ReactNode; className?: string }) {
  useLocale();
  return (
    <section className={`acc-section ${className}`} aria-label={title}>
      <div className="acc-section-head">
        <h2 data-locale-motion>{title}</h2>
        <p data-locale-motion>{desc}</p>
      </div>
      <div className="acc-card">{children}</div>
    </section>
  );
}

// 52 高设置行：标签| 当前值 | 右侧操作
function Row({ label, value, onClick, children }: { label: string; value?: ReactNode; onClick?: () => void; children?: ReactNode }) {
  useLocale();
  const body = (
    <>
      <span className="acc-row-label" data-locale-motion>{label}</span>
      {value != null && <span className="acc-row-value">{value}</span>}
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className="acc-row is-button" onClick={onClick}>{body}</button>
  ) : (
    <div className="acc-row">{body}</div>
  );
}

function RowLink({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  useLocale();
  return (
    <button type="button" className="acc-row-link" disabled={disabled} onClick={onClick}>
      <span data-locale-motion>{label}</span>
      <Icon name="chev" size={12} />
    </button>
  );
}

// 弹窗底部：分隔线 + 取消 / 主按钮（右对齐）
function Foot({ left, cancel = t("取消"), confirm, confirmWidth = 100, danger = false, disabled = false, busy = false, onCancel, onConfirm }: {
  left?: ReactNode;
  cancel?: string;
  confirm?: string;
  confirmWidth?: number;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm?: () => void;
}) {
  useLocale();
  return (
    <div className="v3-dialog-foot acc-foot">
      <div className="v3-dialog-foot-left">{left}</div>
      <button type="button" className="v3-btn v3-btn-ghost acc-btn-80" disabled={busy} onClick={onCancel}>{cancel}</button>
      {confirm && (
        <button
          type="button"
          className={`v3-btn ${danger ? "v3-btn-danger" : "v3-btn-dark"}`}
          style={{ width: confirmWidth }}
          disabled={disabled || busy}
          onClick={onConfirm}
        >
          {confirm}
        </button>
      )}
    </div>
  );
}

/* ───────────── 08.4a 编辑资料（620×492） ───────────── */

function EditProfileDialog({ user, onClose, onUserUpdate, onSaved, onError, onNotice }: {
  user: UserProfile;
  onClose: () => void;
  onUserUpdate: (user: UserProfile) => void;
  onSaved: (message: string) => void;
  onError: (message: string | null) => void;
  onNotice: (title: string) => void;
}) {
  useLocale();
  const [nickname, setNickname] = useState(user.nickname);
  const [draft, setDraft] = useState<AvatarCropDraft | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<AvatarDrag | null>(null);
  const readRequestRef = useRef(0);
  const layout = draft ? getAvatarCropLayout(draft) : null;
  const currentAvatar = removeAvatar ? null : user.avatar_url;

  const fail = (message: string) => {
    setError(message);
    onError(message);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      onNotice(t("头像图片不能超过 10MB。"));
      return;
    }
    const requestId = ++readRequestRef.current;
    try {
      const image = await readAvatarImage(file);
      if (requestId !== readRequestRef.current) return;
      setDraft({ ...image, zoom: AVATAR_CROP_MIN_ZOOM, offsetX: 0, offsetY: 0 });
      setRemoveAvatar(false);
    } catch {
      if (requestId !== readRequestRef.current) return;
      onNotice(t("头像图片无法读取，请选择其他图片。"));
    }
  };

  const updateDraft = (update: (current: AvatarCropDraft) => AvatarCropDraft) => {
    setDraft((current) => (current ? clampAvatarCropDraft(update(current)) : current));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft || saving || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: draft.offsetX, offsetY: draft.offsetY };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // 裁剪区按 CROP_SCALE 缩小显示，屏幕位移要换算回 320 坐标系
    updateDraft((current) => ({ ...current, offsetX: drag.offsetX + (event.clientX - drag.startX) / CROP_SCALE, offsetY: drag.offsetY + (event.clientY - drag.startY) / CROP_SCALE }));
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onCropKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!draft || saving) return;
    const amount = event.shiftKey ? 16 : 4;
    const delta = { ArrowLeft: [-amount, 0], ArrowRight: [amount, 0], ArrowUp: [0, -amount], ArrowDown: [0, amount] }[event.key];
    if (!delta) return;
    event.preventDefault();
    updateDraft((current) => ({ ...current, offsetX: current.offsetX + delta[0], offsetY: current.offsetY + delta[1] }));
  };

  // 依次保存：昵称（有变化才提交）→ 新头像上传 / 移除头像。任一步失败保留弹窗和裁剪状态
  const save = async () => {
    if (saving) return;
    const trimmed = nickname.trim();
    if (!trimmed || trimmed.length > MAX_NICKNAME_LENGTH) {
      fail(t("昵称不能为空，且不能超过 {value0} 个字符。", { value0: MAX_NICKNAME_LENGTH }));
      return;
    }
    setSaving(true);
    setError(null);
    let latest = user;
    try {
      if (trimmed !== user.nickname) {
        try {
          latest = await api.updateAccountProfile(trimmed);
          onUserUpdate(latest);
        } catch (saveError) {
          fail(accountErrorMessage(saveError, t("昵称保存失败，请稍后重试。")));
          return;
        }
      }
      if (draft) {
        try {
          if (!cropImageRef.current) throw new Error("IMAGE_NOT_READY");
          const dataUrl = createAvatarCropDataUrl(cropImageRef.current, draft);
          const { url } = await api.uploadAccountAvatar({ fileName: "avatar.png", dataUrl });
          latest = { ...latest, avatar_url: url };
          onUserUpdate(latest);
          setDraft(null);
        } catch (uploadError) {
          fail(accountErrorMessage(uploadError, t("头像处理或上传失败，请重试。")));
          return;
        }
      } else if (removeAvatar && user.avatar_url) {
        try {
          await api.deleteAccountAvatar();
          latest = { ...latest, avatar_url: null };
          onUserUpdate(latest);
        } catch (deleteError) {
          fail(accountErrorMessage(deleteError, t("头像删除失败，请稍后重试。")));
          return;
        }
      }
      onSaved(draft ? t("头像已更新。") : removeAvatar && user.avatar_url ? t("头像已删除。") : t("资料已保存。"));
    } finally {
      setSaving(false);
    }
  };

  // 三种尺寸预览：把裁剪窗口里的画面按比例缩到 56 / 36 / 24
  const preview = (size: number) => {
    if (draft && layout) {
      const k = size / AVATAR_CROP_WINDOW_SIZE;
      const inset = (AVATAR_CROP_VIEWPORT_SIZE - AVATAR_CROP_WINDOW_SIZE) / 2;
      const left = (AVATAR_CROP_VIEWPORT_SIZE / 2 - layout.renderedWidth / 2 + draft.offsetX - inset) * k;
      const top = (AVATAR_CROP_VIEWPORT_SIZE / 2 - layout.renderedHeight / 2 + draft.offsetY - inset) * k;
      return (
        <span key={size} className="acc-preview" style={{ width: size, height: size }}>
          <img src={draft.dataUrl} alt="" style={{ left, top, width: layout.renderedWidth * k, height: layout.renderedHeight * k }} />
        </span>
      );
    }
    return <Avatar key={size} name={nickname.trim() || user.nickname} src={currentAvatar} size={size} />;
  };

  return (
    <Dialog width={620} label={t("编辑资料")} onClose={() => { if (!saving) onClose(); }} closable={!saving} className="acc-dialog">
      <div className="v3-dialog-body acc-edit-body" aria-busy={saving}>
        <h2 className="v3-dialog-title">{t("编辑资料")}</h2>
        <p className="v3-dialog-sub">{t("头像和昵称会显示在侧栏、分享页和 AI 对话里。")}</p>

        <div className="acc-edit-grid">
          <div>
            <div
              className={`acc-crop${draft ? " is-draft" : ""}`}
              role="group"
              tabIndex={0}
              aria-label={draft ? t("头像裁剪区域，可使用方向键移动") : t("头像区域，点击选择图片")}
              onKeyDown={onCropKeyDown}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onClick={() => { if (!draft) fileInputRef.current?.click(); }}
            >
              <span className="acc-crop-stage" style={{ width: AVATAR_CROP_VIEWPORT_SIZE, height: AVATAR_CROP_VIEWPORT_SIZE, transform: `scale(${CROP_SCALE})` }}>
              {draft ? (
                <img
                  ref={cropImageRef}
                  className="acc-crop-image"
                  src={draft.dataUrl}
                  alt=""
                  draggable={false}
                  style={{
                    width: `${layout?.renderedWidth ?? AVATAR_CROP_VIEWPORT_SIZE}px`,
                    height: `${layout?.renderedHeight ?? AVATAR_CROP_VIEWPORT_SIZE}px`,
                    transform: `translate(-50%, -50%) translate(${draft.offsetX}px, ${draft.offsetY}px)`,
                  }}
                />
              ) : currentAvatar ? (
                <img className="acc-crop-current" src={currentAvatar} alt="" draggable={false} />
              ) : (
                <span className="acc-crop-empty"><Avatar name={nickname.trim() || user.nickname} size={AVATAR_CROP_WINDOW_SIZE} /></span>
              )}
              <span className="acc-crop-window" aria-hidden="true" style={{ width: AVATAR_CROP_WINDOW_SIZE, height: AVATAR_CROP_WINDOW_SIZE }} />
              </span>
              <span className="acc-crop-hint" aria-hidden="true">{draft ? t("拖动调整位置") : t("点击选择图片")}</span>
            </div>
            <label className="acc-zoom">
              <span>{t("缩放")}</span>
              <input
                type="range"
                aria-label={t("缩放")}
                min={AVATAR_CROP_MIN_ZOOM}
                max={AVATAR_CROP_MAX_ZOOM}
                step="0.01"
                value={draft?.zoom ?? AVATAR_CROP_MIN_ZOOM}
                disabled={!draft || saving}
                style={{ ["--p" as string]: `${(((draft?.zoom ?? 1) - AVATAR_CROP_MIN_ZOOM) / (AVATAR_CROP_MAX_ZOOM - AVATAR_CROP_MIN_ZOOM)) * 100}%` }}
                onChange={(event) => {
                  const zoom = Number(event.currentTarget.value);
                  updateDraft((current) => ({ ...current, zoom }));
                }}
              />
            </label>
          </div>

          <div className="acc-edit-side">
            <label className="acc-edit-label" htmlFor="acc-nickname">
              <span>{t("昵称")}<em>*</em></span>
              <small className="v3-num">{[...nickname].length} / {MAX_NICKNAME_LENGTH}</small>
            </label>
            <input
              id="acc-nickname"
              className="v3-input"
              aria-label={t("昵称")}
              value={nickname}
              maxLength={MAX_NICKNAME_LENGTH}
              disabled={saving}
              aria-invalid={Boolean(error && error.includes(t("昵称")))}
              onChange={(event) => setNickname(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
              }}
            />

            <span className="acc-edit-label is-gap">{t("头像")}</span>
            <div className="acc-avatar-actions">
              <button type="button" className="v3-btn v3-btn-ghost acc-reselect" disabled={saving} onClick={() => fileInputRef.current?.click()}>
                <Icon name="upload" size={13} />{t("重新选择")}</button>
              <button
                type="button"
                className="acc-remove"
                disabled={saving || (!draft && !currentAvatar)}
                onClick={() => {
                  readRequestRef.current += 1;
                  setDraft(null);
                  setRemoveAvatar(true);
                }}
              >{t("移除头像")}</button>
            </div>
            <p className="acc-edit-hint">{t("支持 JPG、PNG、WebP，最大 10 MB。")}</p>
            <input
              ref={fileInputRef}
              className="v3-visually-hidden"
              type="file"
              accept="image/*"
              aria-label={t("选择头像图片")}
              tabIndex={-1}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void pickFile(file);
              }}
            />

            <span className="acc-edit-label is-gap2">{t("预览")}</span>
            <div className="acc-previews">{[56, 36, 24].map(preview)}</div>
          </div>
        </div>
      </div>
      <Foot
        left={error && <span className="acc-foot-error" role="alert">{error}</span>}
        confirm={saving ? t("保存中…") : t("保存")}
        confirmWidth={88}
        busy={saving}
        onCancel={onClose}
        onConfirm={() => void save()}
      />
    </Dialog>
  );
}

/* ───────────── 08.4b 联系邮箱（520×628） ───────────── */

function ChangeEmailDialog({ email, onClose, onSaved }: { email: string | null; onClose: () => void; onSaved: (email: string | null) => void }) {
  useLocale();
  const [draft, setDraft] = useState(email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = !draft.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.trim());
  const save = async () => {
    if (saving || !valid) return;
    setSaving(true); setError(null);
    try { const result = await api.updateContactEmail(draft.trim() || null); onSaved(result.contact_email); }
    catch (failure) { setError(accountErrorMessage(failure, t("联系邮箱保存失败，请重试。"))); }
    finally { setSaving(false); }
  };
  return <Dialog width={520} label={t("联系邮箱")} closable={!saving} onClose={() => { if (!saving) onClose(); }} className="acc-dialog">
    <div className="v3-dialog-body acc-form-body"><h2 className="v3-dialog-title">{t("联系邮箱")}</h2><p className="v3-dialog-sub">{t("用于联系信息；保存后不会发送验证邮件或通知。")}</p><div className="v3-stage acc-art" style={{ height: 120 }}><ChangeEmailArt email={email ?? t("未设置")} /></div><div className="acc-fld"><span className="acc-fld-label">{t("邮箱地址")}</span><IconInput icon="mail" value={draft} type="email" ariaLabel={t("邮箱地址")} placeholder="you@example.com" onChange={setDraft} /></div><p className="acc-note">{t("留空即可清除联系邮箱。")}</p></div>
    <Foot left={error && <span role="alert">{error}</span>} confirm={saving ? t("保存中…") : t("保存")} busy={saving} disabled={!valid || (draft.trim() || null) === email} onCancel={onClose} onConfirm={() => void save()} />
  </Dialog>;
}

function IconInput({ icon, value, placeholder, ariaLabel, type = "text", readOnly, onChange, trailing }: {
  icon: V3IconName;
  value: string;
  placeholder?: string;
  ariaLabel: string;
  type?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  trailing?: ReactNode;
}) {
  useLocale();
  return (
    <span className={`acc-icon-input${readOnly ? " is-readonly" : ""}`}>
      <Icon name={icon} size={14} />
      <input className="v3-input" type={type} aria-label={ariaLabel} value={value} placeholder={placeholder} readOnly={readOnly} onChange={(event) => onChange?.(event.target.value)} />
      {trailing}
    </span>
  );
}

/* ───────────── 08.4c 修改密码（520×634） ───────────── */

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  useLocale();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false });
  const longEnough = next.length >= 8;
  const mixed = /[A-Za-z]/.test(next) && /\d/.test(next);

  const save = async () => {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      await api.changePassword({ current_password: current, new_password: next, confirm_password: confirm });
      useResumeStore.getState().clearSession();
      navigateTo("/login", { replace: true });
    } catch (failure) { setError(accountErrorMessage(failure, t("密码修改失败，请重试。"))); setSaving(false); }
  };
  const field = (key: keyof typeof visible, label: string, value: string, set: (value: string) => void, autoComplete: string) => (
    <div className="acc-fld">
      <span className="acc-fld-label">{label}<em>*</em></span>
      <span className="acc-icon-input">
        <Icon name="lock" size={14} />
        <input className="v3-input" type={visible[key] ? "text" : "password"} aria-label={label} autoComplete={autoComplete} value={value} onChange={(event) => set(event.target.value)} />
        <button type="button" className="acc-eye" aria-label={visible[key] ? t("隐藏{value0}", { value0: label }) : t("显示{value0}", { value0: label })} onClick={() => setVisible((prev) => ({ ...prev, [key]: !prev[key] }))}>
          <Icon name="eye" size={14} />
        </button>
      </span>
    </div>
  );

  return (
    <Dialog width={520} label={t("修改密码")} closable={!saving} onClose={() => { if (!saving) onClose(); }} className="acc-dialog">
      <div className="v3-dialog-body acc-form-body">
        <h2 className="v3-dialog-title">{t("修改密码")}</h2>
        <p className="v3-dialog-sub">{t("修改后所有设备都会退出，需要用新密码重新登录。")}</p>
        <div className="v3-stage acc-art" style={{ height: 96 }}><ChangePasswordArt /></div>
        {field("current", t("当前密码"), current, setCurrent, "current-password")}
        {field("next", t("新密码"), next, setNext, "new-password")}
        <div className="acc-rules">
          <span className={longEnough ? "is-ok" : ""}><Icon name="check" size={12} />{t("至少 8 位")}</span>
          <span className={mixed ? "is-ok" : ""}><Icon name="check" size={12} />{t("同时包含字母和数字")}</span>
        </div>
        {field("confirm", t("确认新密码"), confirm, setConfirm, "new-password")}
        <p className="acc-note">{confirm && confirm !== next ? t("两次输入的新密码不一致。") : t("新密码不能和当前密码相同。")}</p>
      </div>
      <Foot confirm={t("确认修改")} disabled={!current || !longEnough || !mixed || confirm !== next || next === current} onCancel={onClose} busy={saving} left={error && <span role="alert">{error}</span>} onConfirm={() => void save()} />
    </Dialog>
  );
}

/* ───────────── 08.4h 退出：居中确认（420×410） ───────────── */

function CenterConfirm({ label, title, desc, art, impacts, confirmLabel, danger = false, busy = false, onClose, onConfirm }: {
  label: string;
  title: ReactNode;
  desc: string;
  art: ReactNode;
  impacts: Array<{ icon: V3IconName; text: string }>;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useLocale();
  return (
    <Dialog width={420} label={label} onClose={() => { if (!busy) onClose(); }} closable={!busy} className="v3-confirm acc-confirm">
      <div className="v3-dialog-body">
        <div className="v3-stage has-dots">{art}</div>
        <h2 className="v3-dialog-title">{title}</h2>
        <div className="v3-dialog-sub">{desc}</div>
        <ul className="acc-impact">
          {impacts.map((item) => (
            <li key={item.text}><Icon name={item.icon} size={14} />{item.text}</li>
          ))}
        </ul>
      </div>
      <div className="v3-confirm-foot acc-confirm-foot">
        <button type="button" className="v3-btn v3-btn-ghost" disabled={busy} onClick={onClose}>{t("取消")}</button>
        <button type="button" className={`v3-btn ${danger ? "v3-btn-danger" : "v3-btn-dark"}`} disabled={busy} onClick={onConfirm} data-autofocus>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

/* ───────────── 08.4i 注销账号（480×570） ───────────── */

const DELETE_WORD = "注销账号";

function DeleteAccountDialog({ initial, resumeCount, method, onClose }: { initial: string; resumeCount: number; method: "password" | "wechat"; onClose: () => void }) {
  useLocale();
  const [word, setWord] = useState("");
  const [password, setPassword] = useState("");
  const [verification, setVerification] = useState<Awaited<ReturnType<typeof api.createAccountVerification>> | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const [status, setStatus] = useState("pending");
  const [qrBusy, setQrBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentVerification = useRef(verification);
  const accepted = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; generation.current += 1;
    if (currentVerification.current && !accepted.current) void api.cancelAccountVerification(currentVerification.current).catch(() => undefined);
  }; }, []);
  const refreshQr = async () => {
    const request = ++generation.current;
    setQrBusy(true); setProof(null); setVerification(null); currentVerification.current = null; setError(null);
    try {
      const data = await api.createAccountVerification();
      if (!mounted.current || generation.current !== request) { void api.cancelAccountVerification(data).catch(() => undefined); return; }
      currentVerification.current = data; setVerification(data); setStatus("pending");
    } catch (failure) { if (mounted.current && generation.current === request) setError(accountErrorMessage(failure, t("二维码获取失败，请重试。"))); }
    finally { if (mounted.current && generation.current === request) setQrBusy(false); }
  };
  useEffect(() => {
    if (!verification) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (Date.now() >= new Date(verification.expires_at).getTime()) { setProof(null); setStatus("expired"); return; }
      try {
        const result = await api.accountVerificationStatus(verification);
        if (!active || currentVerification.current?.scene !== verification.scene) return;
        setStatus(result.status); setProof(result.status === "verified" ? result.action_token ?? null : null);
        if (result.status === "pending" || result.status === "verified") timer = setTimeout(() => void tick(), 2000);
      } catch (failure) { if (active) { setProof(null); setError(accountErrorMessage(failure, t("身份确认失败，请刷新二维码。"))); } }
    };
    timer = setTimeout(() => void tick(), 2000);
    return () => { active = false; clearTimeout(timer); };
  }, [verification]);
  const submit = async () => {
    if (busy || word !== DELETE_WORD || (method === "wechat" && !proof) || (method === "password" && !password)) return;
    setBusy(true); setError(null);
    try {
      const result = await api.deleteAccount(method === "password" ? { method, confirmation: word, current_password: password } : { method, confirmation: word, action_token: proof! });
      accepted.current = true; saveDeletionReceipt(result);
      navigateTo("/account-deletion", { replace: true });
      useResumeStore.getState().clearSession();
    } catch (failure) { setError(accountErrorMessage(failure, t("注销未完成，请重试。"))); setBusy(false); }
  };
  return <Dialog width={480} label={t("注销账号")} closable={!busy} onClose={() => { if (!busy) onClose(); }} className="acc-dialog">
    <div className="v3-dialog-body acc-form-body"><h2 className="v3-dialog-title">{t("注销账号")}</h2><p className="v3-dialog-sub">{t("受理后立即停用登录和分享，后台永久清理个人数据，无法恢复。")}</p><div className="v3-stage acc-art" style={{ height: 104 }}><DeleteAccountArt initial={initial} /></div>
      <ul className="acc-impact is-list"><li><Icon name="doc" size={14} />{resumeCount}{t("份简历和公开分享链接")}</li><li><Icon name="brief" size={14} />{t("全部求职记录和面试安排")}</li><li><Icon name="folder" size={14} />{t("资料库里的全部文件")}</li><li><Icon name="user" size={14} />{t("个人画像和 AI 对话记录")}</li></ul>
      {method === "password" && <div className="acc-fld"><span className="acc-fld-label">{t("当前密码")}</span><IconInput icon="lock" value={password} ariaLabel={t("当前密码")} type="password" onChange={setPassword} /></div>}
      {method === "wechat" && <div className="acc-fld"><p>{t("用当前账号的微信扫码，仅确认注销身份。")}</p>{verification && <img width={180} height={180} src={`data:image/png;base64,${verification.qrcode_data}`} alt={t("注销身份确认二维码")} />}{status === "verified" && <p role="status">{t("身份已确认")}</p>}{status === "expired" && <p role="status">{t("二维码已过期，请刷新。")}</p>}<button type="button" className="v3-btn" disabled={qrBusy || busy} onClick={() => void refreshQr()}>{qrBusy ? t("加载中…") : verification ? t("刷新二维码") : t("获取确认二维码")}</button></div>}
      <div className="acc-fld"><label className="acc-fld-label" htmlFor="account-delete-word">{t("输入「")}{DELETE_WORD}{t("」确认")}</label><input id="account-delete-word" className="v3-input" placeholder={DELETE_WORD} value={word} onChange={(event) => setWord(event.target.value)} /></div>
    </div>
    <Foot confirm={busy ? t("正在受理…") : t("永久注销")} confirmWidth={104} danger busy={busy} left={error && <span role="alert">{error}</span>} disabled={word !== DELETE_WORD || (method === "password" ? !password : !proof)} onCancel={onClose} onConfirm={() => void submit()} />
  </Dialog>;
}
