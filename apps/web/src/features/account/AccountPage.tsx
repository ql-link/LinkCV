import { MotionPresence } from "@/components/ui/motion";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { Reveal, SkeletonCards } from "@/v3/skeletons";
import { readPageCache, updatePageCache, useRevalidateOnFocus, writePageCache } from "@/v3/pageCache";
import bindQrAsset from "../../assets/figma/account-bind-qr.svg";
import { api, AccountProfile, UserProfile } from "../../api/client";
import { navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";
import { Icon, type V3IconName } from "../../v3/Icon";
import { MOCK_ACCOUNT_META, MOCK_ACCOUNT_PREFS } from "../../v3/mocks";
import { Avatar, BeTag, Dialog, Toast, Toggle, PageEyebrow } from "../../v3/primitives";
import "./account.css";
import { ChangeEmailArt, ChangePasswordArt, DeleteAccountArt, LogoutArt, UnbindWechatArt } from "./accountArt";
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

const ACCOUNT_CACHE_KEY = "account-profile";

export { accountErrorMessage } from "./accountErrors";

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
// 设计稿裁剪区 232×232、圆窗 192；avatarCrop 的坐标系是 320 / 264，整体缩放 0.725 显示
const CROP_SCALE = 232 / AVATAR_CROP_VIEWPORT_SIZE;
// 未提供接口的账号操作只在本页模拟，不写入登录资料或持久化状态。
const NEEDS_BACKEND = { title: "该功能需要后端支持", message: "当前为界面示例，没有保存任何修改。" };

type ToastState = { kind: "success" | "error" | "warn"; title: string; message?: string } | null;
type DialogKind = "profile" | "email" | "password" | "bindWechat" | "unbindWechat" | "logout" | "delete" | "avatarPreview" | null;

type AvatarDrag = { pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number };

// 08.4 账号：顶部资料卡 + 四个「左栏标题 / 右栏设置卡」区块
export function AccountPage() {
  const syncProfile = useResumeStore((state) => state.syncProfile);
  const logout = useResumeStore((state) => state.logout);
  // 回到账号页时先用上一次的资料直接显示，超过 5 分钟再在后台静默刷新
  const [profile, setProfile] = useState<AccountProfile | null>(() => readPageCache<AccountProfile>(ACCOUNT_CACHE_KEY)?.value ?? null);
  const [loading, setLoading] = useState(() => !readPageCache(ACCOUNT_CACHE_KEY));
  const [loadFailed, setLoadFailed] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [localAccount, setLocalAccount] = useState<Partial<UserProfile>>({});
  const [reminderOn, setReminderOn] = useState(MOCK_ACCOUNT_PREFS.interviewReminderOn);
  const [passwordChanged, setPasswordChanged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = readPageCache<AccountProfile>(ACCOUNT_CACHE_KEY);
    if (cached?.fresh) return undefined;
    void (async () => {
      try {
        const data = await api.getAccountProfile();
        if (cancelled) return;
        setProfile(data);
        writePageCache(ACCOUNT_CACHE_KEY, data);
        syncProfile(data.user);
      } catch {
        if (!cancelled && !cached) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [syncProfile]);

  // 窗口回到前台：后台静默刷新账号资料
  useRevalidateOnFocus(() => {
    void api.getAccountProfile().then((data) => { setProfile(data); writePageCache(ACCOUNT_CACHE_KEY, data); syncProfile(data.user); }).catch(() => undefined);
  });

  // 本页改了昵称、头像、绑定等，也同步进缓存，下次进入看到的是最新资料
  useEffect(() => {
    if (profile) updatePageCache(ACCOUNT_CACHE_KEY, profile);
  }, [profile]);

  const applyUserUpdate = (user: UserProfile) => {
    syncProfile(user);
    setProfile((current) => (current ? { ...current, user } : current));
  };

  const needsBackend = () => setToast({ kind: "warn", ...NEEDS_BACKEND });
  const finishLocalChange = (title: string, message = "仅本次页面访问有效，未修改真实账号；刷新后恢复。") => {
    setDialog(null);
    setToast({ kind: "warn", title: `${title}（本地模拟）`, message });
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      navigateTo("/", { replace: true });
    } catch {
      setToast({ kind: "error", title: "退出失败", message: "退出登录失败，请稍后重试。" });
      setLoggingOut(false);
    }
  };

  const user = profile ? { ...profile.user, ...localAccount } : undefined;
  const hasEmail = Boolean(user?.email);
  const wechatBound = user?.wechat_status === "bound";
  const initial = [...(user?.nickname.trim() || "我")][0];

  return (
    <div className="acc-page">
      <PageEyebrow segments={["ACCOUNT", user?.email || (user ? "微信登录" : null)]} />
      <h1 className="v3-page-title">账号</h1>
      <p className="v3-page-sub acc-sub">管理个人资料、登录安全与偏好设置。</p>

      <Reveal loading={loading} placeholder={<SkeletonCards cards={[92, 168, 132]} label="正在加载个人资料…" className="acc-loading" />}>

      {!loading && loadFailed && !profile && (
        <section className="v3-empty is-error acc-load-error" role="alert">
          <div className="v3-stage has-dots" />
          <h3>暂时无法读取个人资料</h3>
          <p>请检查网络连接后重新加载。</p>
          <div className="v3-empty-actions">
            <button type="button" className="v3-btn v3-btn-dark" onClick={() => window.location.reload()}>重新加载</button>
          </div>
        </section>
      )}

      {user && (
        <div>
          {/* 10.3 局部状态 · 保存失败：标题下方的行内提示 */}
          {inlineError && (
            <div className="acc-inline-error" role="alert">
              <span className="acc-inline-error-ic" aria-hidden="true">!</span>
              <strong>保存失败</strong>
              <span>{inlineError}</span>
              <button type="button" className="v3-icon-btn" aria-label="关闭提示" onClick={() => setInlineError(null)}>
                <Icon name="x" size={12} />
              </button>
            </div>
          )}

          <section className="acc-hero" aria-label="个人资料摘要">
            <button
              type="button"
              className="acc-hero-avatar"
              aria-label={user.avatar_url ? "查看头像原图" : "头像预览不可用"}
              disabled={!user.avatar_url}
              onClick={() => setDialog("avatarPreview")}
            >
              <Avatar name={user.nickname} src={user.avatar_url} size={56} />
            </button>
            <div className="acc-hero-copy">
              <div className="acc-hero-name">
                <h2>{user.nickname}</h2>
                {hasEmail && <span className="acc-verified">邮箱已验证</span>}
                {hasEmail && <BeTag title="账号接口没有邮箱验证状态" />}
              </div>
              <p className="acc-hero-meta">
                <span>{hasEmail ? user.email : "微信登录"} · 注册于 {MOCK_ACCOUNT_META.registeredAt}</span>
                <BeTag title="账号接口没有注册时间" />
              </p>
            </div>
            <button type="button" className="v3-btn v3-btn-ghost acc-hero-edit" onClick={() => { setInlineError(null); setDialog("profile"); }}>
              编辑资料
            </button>
          </section>

          <Section title="账号与安全" desc="登录方式和账号安全。至少保留一种登录方式。">
            <Row label="登录邮箱" be value={hasEmail ? user.email! : "未绑定"}>
              <RowLink label={hasEmail ? "修改" : "绑定"} onClick={() => setDialog("email")} />
            </Row>
            <Row
              label="登录密码"
              be
              value={hasEmail ? <>上次修改 {passwordChanged ? "刚刚（本地模拟）" : MOCK_ACCOUNT_META.passwordChangedAt}<BeTag title="账号接口没有上次修改密码时间" /></> : "绑定邮箱后可以设置"}
            >
              <RowLink label="修改" disabled={!hasEmail} onClick={() => setDialog("password")} />
            </Row>
            <Row
              label="微信"
              be
              value={wechatBound ? `已绑定 · ${user.nickname}` : user.wechat_status === "unavailable" ? "当前环境不可用" : "未绑定"}
            >
              {wechatBound ? (
                // 只有微信一种登录方式时不能解绑，避免账号无法再登录
                <button
                  type="button"
                  className="v3-btn v3-btn-ghost is-sm acc-row-btn"
                  disabled={!hasEmail}
                  title={hasEmail ? undefined : "只有微信一种登录方式时不能解绑"}
                  onClick={() => setDialog("unbindWechat")}
                >
                  解绑
                </button>
              ) : (
                <button type="button" className="v3-btn v3-btn-ghost is-sm acc-row-btn" title="本地模拟，不会绑定真实微信" onClick={() => setDialog("bindWechat")}>绑定</button>
              )}
            </Row>
          </Section>

          <Section title="求职资料" desc="生成简历时会用到的个人信息，所有简历共用。">
            <UserProfilePanel />
          </Section>

          <Section title="偏好" desc="界面显示与消息提醒。">
            <Row label="界面语言" onClick={needsBackend}>
              <span className="acc-row-right">
                <BeTag title="暂不支持切换界面语言" />
                <span className="acc-row-meta">{MOCK_ACCOUNT_META.language}</span>
                <Icon name="chev" size={12} />
              </span>
            </Row>
            <Row label="面试提醒" be value={MOCK_ACCOUNT_PREFS.interviewReminderLabel}>
              <Toggle checked={reminderOn} label="面试提醒" onChange={(checked) => { setReminderOn(checked); setToast({ kind: "warn", title: `面试提醒已${checked ? "开启" : "关闭"}（本地模拟）`, message: "仅本次页面访问有效，未保存到账号，也不会发送通知。" }); }} />
            </Row>
          </Section>

          <Section title="退出与注销" desc="注销后简历、岗位记录和资料库都会删除，无法恢复。">
            <Row label="退出登录" value={<>当前设备 · {MOCK_ACCOUNT_META.device}<BeTag title="会话接口不返回设备信息" /></>}>
              <button type="button" className="v3-btn v3-btn-ghost is-sm acc-row-btn" onClick={() => setDialog("logout")}>退出</button>
            </Row>
            <Row label="注销账号" be value="永久删除账号和所有数据">
              <button type="button" className="acc-row-danger" onClick={() => setDialog("delete")}>注销账号</button>
            </Row>
          </Section>

          <MotionPresence>{dialog === "profile" && (
            <EditProfileDialog
              user={user}
              onClose={() => setDialog(null)}
              onUserUpdate={applyUserUpdate}
              onError={setInlineError}
              onSaved={(message) => {
                setDialog(null);
                setInlineError(null);
                setToast({ kind: "success", title: message });
              }}
              onNotice={(title) => setToast({ kind: "error", title })}
            />
          )}</MotionPresence>
          <MotionPresence>{dialog === "email" && <ChangeEmailDialog email={user.email} onClose={() => setDialog(null)} onNotice={(message) => setToast({ kind: "warn", title: "验证码已生成（本地模拟）", message })} onConfirm={(email) => { setLocalAccount((current) => ({ ...current, email })); finishLocalChange("邮箱已修改", "未发送邮件、未修改真实登录邮箱；刷新后恢复。"); }} />}</MotionPresence>
          <MotionPresence>{dialog === "password" && <ChangePasswordDialog onClose={() => setDialog(null)} onConfirm={() => { setPasswordChanged(true); finishLocalChange("密码修改流程已完成", "未校验或修改真实密码，所有设备的登录状态保持不变。"); }} />}</MotionPresence>
          <MotionPresence>{dialog === "bindWechat" && <BindWechatDialog onClose={() => setDialog(null)} onComplete={() => { setLocalAccount((current) => ({ ...current, wechat_status: "bound" })); finishLocalChange("微信已绑定", "未连接微信、未绑定真实微信账号；刷新后恢复。"); }} />}</MotionPresence>
          <MotionPresence>{dialog === "unbindWechat" && (
            <CenterConfirm
              label="解绑微信？"
              title={<>解绑微信？<span className="acc-need-tag">需要后端支持</span></>}
              desc="解绑后不能再用微信扫码登录这个账号。"
              art={<UnbindWechatArt initial={initial} />}
              impacts={[
                { icon: "check", text: `仍可以用 ${user.email ?? "邮箱"} 登录` },
                { icon: "send", text: "面试提醒不再推送到微信" },
              ]}
              confirmLabel="解绑"
              danger
              onClose={() => setDialog(null)}
              onConfirm={() => { setLocalAccount((current) => ({ ...current, wechat_status: "unbound" })); finishLocalChange("微信已解绑"); }}
            />
          )}</MotionPresence>
          <MotionPresence>{dialog === "logout" && (
            <CenterConfirm
              label="确认退出登录"
              title="确认退出登录？"
              desc="退出后需要重新登录。"
              art={<LogoutArt initial={initial} />}
              impacts={[
                { icon: "logout", text: `当前设备 · ${MOCK_ACCOUNT_META.device} 会退出` },
                { icon: "check", text: "其他设备上的登录不受影响" },
              ]}
              confirmLabel={loggingOut ? "正在退出…" : "退出登录"}
              busy={loggingOut}
              onClose={() => setDialog(null)}
              onConfirm={() => void handleLogout()}
            />
          )}</MotionPresence>
          <MotionPresence>{dialog === "delete" && (
            <DeleteAccountDialog initial={initial} resumeCount={profile!.resume_count} onClose={() => setDialog(null)} onConfirm={() => finishLocalChange("注销流程已完成", "未注销真实账号、未删除任何数据，当前登录状态保持不变。")} />
          )}</MotionPresence>
          <MotionPresence>{dialog === "avatarPreview" && user.avatar_url && (
            <Dialog width={420} label="查看头像原图" onClose={() => setDialog(null)} className="acc-avatar-preview">
              <img className="acc-avatar-preview-image" src={user.avatar_url} alt="头像原图" />
            </Dialog>
          )}</MotionPresence>
        </div>
      )}
      </Reveal>

      <MotionPresence>{toast && <Toast kind={toast.kind} title={toast.title} message={toast.message} onDismiss={() => setToast(null)} />}</MotionPresence>
    </div>
  );
}

/* ───────────── 区块与设置行 ───────────── */

function Section({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <section className="acc-section" aria-label={title}>
      <div className="acc-section-head">
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
      <div className="acc-card">{children}</div>
    </section>
  );
}

// 52 高设置行：标签（可带「需后端」）| 当前值 | 右侧操作
function Row({ label, be = false, value, onClick, children }: { label: string; be?: boolean; value?: ReactNode; onClick?: () => void; children?: ReactNode }) {
  const body = (
    <>
      <span className="acc-row-label">{label}{be && <BeTag />}</span>
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
  return (
    <button type="button" className="acc-row-link" disabled={disabled} onClick={onClick}>
      {label}
      <Icon name="chev" size={12} />
    </button>
  );
}

function NeedTag() {
  return <span className="acc-need-tag">需要后端支持</span>;
}

// 弹窗底部：分隔线 + 取消 / 主按钮（右对齐）
function Foot({ left, cancel = "取消", confirm, confirmWidth = 100, danger = false, disabled = false, busy = false, onCancel, onConfirm }: {
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
      onNotice("头像图片不能超过 10MB。");
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
      onNotice("头像图片无法读取，请选择其他图片。");
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
      fail(`昵称不能为空，且不能超过 ${MAX_NICKNAME_LENGTH} 个字符。`);
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
          fail(accountErrorMessage(saveError, "昵称保存失败，请稍后重试。"));
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
          fail(accountErrorMessage(uploadError, "头像处理或上传失败，请重试。"));
          return;
        }
      } else if (removeAvatar && user.avatar_url) {
        try {
          await api.deleteAccountAvatar();
          latest = { ...latest, avatar_url: null };
          onUserUpdate(latest);
        } catch (deleteError) {
          fail(accountErrorMessage(deleteError, "头像删除失败，请稍后重试。"));
          return;
        }
      }
      onSaved(draft ? "头像已更新。" : removeAvatar && user.avatar_url ? "头像已删除。" : "资料已保存。");
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
    <Dialog width={620} label="编辑资料" onClose={() => { if (!saving) onClose(); }} closable={!saving} className="acc-dialog">
      <div className="v3-dialog-body acc-edit-body" aria-busy={saving}>
        <h2 className="v3-dialog-title">编辑资料</h2>
        <p className="v3-dialog-sub">头像和昵称会显示在侧栏、分享页和 AI 对话里。</p>

        <div className="acc-edit-grid">
          <div>
            <div
              className={`acc-crop${draft ? " is-draft" : ""}`}
              role="group"
              tabIndex={0}
              aria-label={draft ? "头像裁剪区域，可使用方向键移动" : "头像区域，点击选择图片"}
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
              <span className="acc-crop-hint" aria-hidden="true">{draft ? "拖动调整位置" : "点击选择图片"}</span>
            </div>
            <label className="acc-zoom">
              <span>缩放</span>
              <input
                type="range"
                aria-label="缩放"
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
              <span>昵称<em>*</em></span>
              <small className="v3-num">{[...nickname].length} / {MAX_NICKNAME_LENGTH}</small>
            </label>
            <input
              id="acc-nickname"
              className="v3-input"
              aria-label="昵称"
              value={nickname}
              maxLength={MAX_NICKNAME_LENGTH}
              disabled={saving}
              aria-invalid={Boolean(error && error.includes("昵称"))}
              onChange={(event) => setNickname(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
              }}
            />

            <span className="acc-edit-label is-gap">头像</span>
            <div className="acc-avatar-actions">
              <button type="button" className="v3-btn v3-btn-ghost acc-reselect" disabled={saving} onClick={() => fileInputRef.current?.click()}>
                <Icon name="upload" size={13} />
                重新选择
              </button>
              <button
                type="button"
                className="acc-remove"
                disabled={saving || (!draft && !currentAvatar)}
                onClick={() => {
                  readRequestRef.current += 1;
                  setDraft(null);
                  setRemoveAvatar(true);
                }}
              >
                移除头像
              </button>
            </div>
            <p className="acc-edit-hint">支持 JPG、PNG、WebP，最大 10 MB。</p>
            <input
              ref={fileInputRef}
              className="v3-visually-hidden"
              type="file"
              accept="image/*"
              aria-label="选择头像图片"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void pickFile(file);
              }}
            />

            <span className="acc-edit-label is-gap2">预览</span>
            <div className="acc-previews">{[56, 36, 24].map(preview)}</div>
          </div>
        </div>
      </div>
      <Foot
        left={error && <span className="acc-foot-error" role="alert">{error}</span>}
        confirm={saving ? "保存中…" : "保存"}
        confirmWidth={88}
        busy={saving}
        onCancel={onClose}
        onConfirm={() => void save()}
      />
    </Dialog>
  );
}

/* ───────────── 08.4b 修改登录邮箱（520×628） · 需后端 ───────────── */

function ChangeEmailDialog({ email, onClose, onConfirm, onNotice }: { email: string | null; onClose: () => void; onConfirm: (email: string) => void; onNotice: (message: string) => void }) {
  const [nextEmail, setNextEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [countdown, setCountdown] = useState(0);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail.trim()) && nextEmail.trim() !== email;
  useEffect(() => {
    if (!countdown) return;
    const timer = window.setTimeout(() => setCountdown((remaining) => Math.max(0, remaining - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);
  // 只用微信登录时是「绑定邮箱」：去掉当前邮箱一行
  const title = email ? "修改登录邮箱" : "绑定邮箱";
  return (
    <Dialog width={520} label={title} onClose={onClose} className="acc-dialog">
      <div className="v3-dialog-body acc-form-body">
        <h2 className="v3-dialog-title">{title}<NeedTag /></h2>
        <p className="v3-dialog-sub">新邮箱验证通过后生效，之后用新邮箱登录。</p>
        <div className="v3-stage acc-art" style={{ height: 120 }}><ChangeEmailArt email={email ?? "未绑定"} /></div>
        {email && (
          <div className="acc-fld">
            <span className="acc-fld-label">当前邮箱</span>
            <IconInput icon="mail" value={email} readOnly ariaLabel="当前邮箱" />
          </div>
        )}
        <div className="acc-fld">
          <span className="acc-fld-label">新邮箱<em>*</em></span>
          <IconInput icon="mail" value={nextEmail} placeholder="输入新的登录邮箱" ariaLabel="新邮箱" type="email" onChange={(value) => { setNextEmail(value); setSentEmail(""); setCountdown(0); }} />
        </div>
        <div className="acc-fld">
          <span className="acc-fld-label">验证码<em>*</em><small>{sentEmail ? "本地模拟，未发送邮件" : "发送到新邮箱"}</small></span>
          <div className="acc-code-row">
            <input className="v3-input v3-num" aria-label="验证码" inputMode="numeric" maxLength={6} placeholder="6 位验证码" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
            <button type="button" className="v3-btn v3-btn-ghost" disabled={!validEmail || countdown > 0} onClick={() => { setSentEmail(nextEmail.trim()); setCountdown(60); onNotice("本地模拟验证码：482913。没有发送真实邮件。"); }}>{countdown > 0 ? `${countdown}秒后重发` : "发送验证码"}</button>
          </div>
        </div>
        <p className="acc-note">修改后旧邮箱会收到一封通知；登录密码不变。</p>
      </div>
      <Foot confirm="确认修改" disabled={!validEmail || sentEmail !== nextEmail.trim() || code !== "482913"} onCancel={onClose} onConfirm={() => onConfirm(nextEmail.trim())} />
    </Dialog>
  );
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
  return (
    <span className={`acc-icon-input${readOnly ? " is-readonly" : ""}`}>
      <Icon name={icon} size={14} />
      <input className="v3-input" type={type} aria-label={ariaLabel} value={value} placeholder={placeholder} readOnly={readOnly} onChange={(event) => onChange?.(event.target.value)} />
      {trailing}
    </span>
  );
}

/* ───────────── 08.4c 修改密码（520×634） · 需后端 ───────────── */

function ChangePasswordDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false });
  const longEnough = next.length >= 8;
  const mixed = /[A-Za-z]/.test(next) && /\d/.test(next);

  const field = (key: keyof typeof visible, label: string, value: string, set: (value: string) => void, autoComplete: string) => (
    <div className="acc-fld">
      <span className="acc-fld-label">{label}<em>*</em></span>
      <span className="acc-icon-input">
        <Icon name="lock" size={14} />
        <input className="v3-input" type={visible[key] ? "text" : "password"} aria-label={label} autoComplete={autoComplete} value={value} onChange={(event) => set(event.target.value)} />
        <button type="button" className="acc-eye" aria-label={visible[key] ? `隐藏${label}` : `显示${label}`} onClick={() => setVisible((prev) => ({ ...prev, [key]: !prev[key] }))}>
          <Icon name="eye" size={14} />
        </button>
      </span>
    </div>
  );

  return (
    <Dialog width={520} label="修改密码" onClose={onClose} className="acc-dialog">
      <div className="v3-dialog-body acc-form-body">
        <h2 className="v3-dialog-title">修改密码<NeedTag /></h2>
        <p className="v3-dialog-sub">修改后所有设备都会退出，需要用新密码重新登录。</p>
        <div className="v3-stage acc-art" style={{ height: 96 }}><ChangePasswordArt /></div>
        {field("current", "当前密码", current, setCurrent, "current-password")}
        {field("next", "新密码", next, setNext, "new-password")}
        <div className="acc-rules">
          <span className={longEnough ? "is-ok" : ""}><Icon name="check" size={12} />至少 8 位</span>
          <span className={mixed ? "is-ok" : ""}><Icon name="check" size={12} />同时包含字母和数字</span>
        </div>
        {field("confirm", "确认新密码", confirm, setConfirm, "new-password")}
        <p className="acc-note">{confirm && confirm !== next ? "两次输入的新密码不一致。" : "新密码不能和当前密码相同。"}</p>
      </div>
      <Foot confirm="确认修改" disabled={!current || !longEnough || !mixed || confirm !== next || next === current} onCancel={onClose} onConfirm={onConfirm} />
    </Dialog>
  );
}

/* ───────────── 08.4d 绑定微信（480×508） · 需后端 ───────────── */

function BindWechatDialog({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [generation, setGeneration] = useState(0);
  const [step, setStep] = useState(0);
  const completeRef = useRef(onComplete);
  useEffect(() => { completeRef.current = onComplete; }, [onComplete]);
  useEffect(() => {
    setStep(0);
    const scanned = window.setTimeout(() => setStep(1), 3500);
    const confirmed = window.setTimeout(() => setStep(2), 6000);
    const complete = window.setTimeout(() => completeRef.current(), 7500);
    return () => { window.clearTimeout(scanned); window.clearTimeout(confirmed); window.clearTimeout(complete); };
  }, [generation]);
  return (
    <Dialog width={480} label="绑定微信" onClose={onClose} className="acc-dialog">
      <div className="v3-dialog-body acc-form-body">
        <h2 className="v3-dialog-title">绑定微信<NeedTag /></h2>
        <p className="v3-dialog-sub">绑定后可以用微信扫码登录这个账号。</p>
        <div className="v3-stage acc-bind-stage">
          <span className="acc-bind-qr"><img src={bindQrAsset} width={168} height={168} alt="本地模拟二维码，不用于真实微信绑定" /><span className="acc-bind-mark" aria-hidden="true">L</span></span>
          <span className="acc-bind-status"><i />本地模拟 · {["等待扫码", "等待确认绑定", "绑定完成"][step]}</span>
        </div>
        <ol className="acc-steps">
          <li className={step === 0 ? "is-on" : undefined}><span>1</span>打开微信扫一扫</li>
          <li className={step === 1 ? "is-on" : undefined}><span>2</span>在手机上确认绑定</li>
          <li className={step === 2 ? "is-on" : undefined}><span>3</span>页面自动完成</li>
        </ol>
      </div>
      <Foot
        left={<button type="button" className="v3-link" onClick={() => setGeneration((value) => value + 1)}><Icon name="refresh" size={13} />刷新二维码</button>}
        onCancel={onClose}
      />
    </Dialog>
  );
}

/* ───────────── 08.4e 解绑 / 08.4h 退出：居中确认（420×410） ───────────── */

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
        <button type="button" className="v3-btn v3-btn-ghost" disabled={busy} onClick={onClose}>取消</button>
        <button type="button" className={`v3-btn ${danger ? "v3-btn-danger" : "v3-btn-dark"}`} disabled={busy} onClick={onConfirm} data-autofocus>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

/* ───────────── 08.4i 注销账号（480×570） · 需后端 ───────────── */

const DELETE_WORD = "注销账号";

function DeleteAccountDialog({ initial, resumeCount, onClose, onConfirm }: { initial: string; resumeCount: number; onClose: () => void; onConfirm: () => void }) {
  const [word, setWord] = useState("");
  return (
    <Dialog width={480} label="注销账号" onClose={onClose} className="acc-dialog">
      <div className="v3-dialog-body acc-form-body">
        <h2 className="v3-dialog-title">注销账号<NeedTag /></h2>
        <p className="v3-dialog-sub">注销后账号和所有数据会永久删除，无法恢复。</p>
        <div className="v3-stage acc-art" style={{ height: 104 }}><DeleteAccountArt initial={initial} /></div>
        <span className="acc-fld-label acc-delete-label">会被永久删除</span>
        <ul className="acc-impact is-list">
          <li><Icon name="doc" size={14} />{resumeCount} 份简历和它们的公开分享链接</li>
          <li><Icon name="brief" size={14} />全部求职记录和面试安排</li>
          <li><Icon name="folder" size={14} />资料库里的全部文件</li>
          <li><Icon name="user" size={14} />个人画像和 AI 对话记录</li>
        </ul>
        <div className="acc-fld">
          <span className="acc-fld-label">输入「{DELETE_WORD}」确认<em>*</em></span>
          <input className="v3-input" aria-label={`输入「${DELETE_WORD}」确认`} placeholder={DELETE_WORD} value={word} onChange={(event) => setWord(event.target.value)} />
        </div>
      </div>
      <Foot confirm="永久注销" confirmWidth={104} danger disabled={word.trim() !== DELETE_WORD} onCancel={onClose} onConfirm={onConfirm} />
    </Dialog>
  );
}
