import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronRight, Pencil, UserRound } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FeedbackNotice,
  Input,
  Label,
  PageLoading,
} from "@/components/ui";
import { api, AccountProfile, ApiRequestError, UserProfile } from "../../api/client";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
import { editorPath, navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";
import {
  AVATAR_CROP_MAX_ZOOM,
  AVATAR_CROP_MIN_ZOOM,
  AVATAR_CROP_VIEWPORT_SIZE,
  clampAvatarCropDraft,
  createAvatarCropDataUrl,
  getAvatarCropLayout,
  readAvatarImage,
  type AvatarCropDraft,
} from "./avatarCrop";

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
const MAX_NICKNAME_LENGTH = 50;
type Notice = { kind: "success" | "error"; message: string } | null;
type AvatarDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
};

export function accountErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    if (error.message === "INVALID_NICKNAME") return `昵称不能为空，且不能超过 ${MAX_NICKNAME_LENGTH} 个字符。`;
    if (error.message === "INVALID_IMAGE") return "请选择有效的图片文件。";
    if (error.message === "IMAGE_TOO_LARGE") return "头像图片不能超过 10MB。";
    if (error.status === 401) return "登录状态已失效，请重新登录。";
    if (error.status >= 500) return "服务暂时不可用，请稍后重试。";
  }
  return fallback;
}

export function AccountPage() {
  const syncProfile = useResumeStore((state) => state.syncProfile);
  const logout = useResumeStore((state) => state.logout);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [nickname, setNickname] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState<AvatarCropDraft | null>(null);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const avatarDragRef = useRef<AvatarDrag | null>(null);
  const avatarReadRequestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.getAccountProfile();
        if (cancelled) return;
        setProfile(data);
        setNickname(data.user.nickname);
        syncProfile(data.user);
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [syncProfile]);

  const applyUserUpdate = (user: UserProfile) => {
    syncProfile(user);
    setProfile((current) => (current ? { ...current, user } : current));
  };

  const saveNickname = async () => {
    const trimmed = nickname.trim();
    if (!trimmed || trimmed.length > MAX_NICKNAME_LENGTH) {
      setNotice({ kind: "error", message: `昵称不能为空，且不能超过 ${MAX_NICKNAME_LENGTH} 个字符。` });
      return;
    }
    setSavingName(true);
    setNotice(null);
    try {
      const updated = await api.updateAccountProfile(trimmed);
      applyUserUpdate(updated);
      setNickname(updated.nickname);
      setNotice({ kind: "success", message: "昵称已更新。" });
    } catch (error) {
      setNotice({ kind: "error", message: accountErrorMessage(error, "昵称保存失败，请稍后重试。") });
    } finally {
      setSavingName(false);
    }
  };

  const pickAvatarFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setNotice({ kind: "error", message: "头像图片不能超过 10MB。" });
      return;
    }
    const requestId = ++avatarReadRequestRef.current;
    setNotice(null);
    try {
      const image = await readAvatarImage(file);
      if (requestId !== avatarReadRequestRef.current) return;
      setAvatarDraft({ ...image, zoom: AVATAR_CROP_MIN_ZOOM, offsetX: 0, offsetY: 0 });
      setAvatarDialogOpen(true);
    } catch {
      if (requestId !== avatarReadRequestRef.current) return;
      setNotice({ kind: "error", message: "头像图片无法读取，请选择其他图片。" });
    }
  };

  const updateAvatarDraft = (update: (current: AvatarCropDraft) => AvatarCropDraft) => {
    setAvatarDraft((current) => (current ? clampAvatarCropDraft(update(current)) : current));
  };

  const discardAvatarDraft = () => {
    if (uploadingAvatar || removingAvatar) return;
    avatarDragRef.current = null;
    cropImageRef.current = null;
    setAvatarDraft(null);
    setAvatarDialogOpen(false);
    setNotice(null);
  };

  const handleAvatarDialogOpenChange = (open: boolean) => {
    if (open) {
      setAvatarDialogOpen(true);
      setNotice(null);
      return;
    }
    discardAvatarDraft();
  };

  const handleCropPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!avatarDraft || uploadingAvatar || removingAvatar || event.button !== 0) return;
    event.preventDefault();
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    avatarDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: avatarDraft.offsetX,
      offsetY: avatarDraft.offsetY,
    };
  };

  const handleCropPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = avatarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateAvatarDraft((current) => ({
      ...current,
      offsetX: drag.offsetX + event.clientX - drag.startX,
      offsetY: drag.offsetY + event.clientY - drag.startY,
    }));
  };

  const handleCropPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (avatarDragRef.current?.pointerId !== event.pointerId) return;
    avatarDragRef.current = null;
    if (typeof event.currentTarget.hasPointerCapture === "function" && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleCropKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!avatarDraft || uploadingAvatar || removingAvatar) return;
    const amount = event.shiftKey ? 16 : 4;
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === "ArrowLeft") deltaX = -amount;
    if (event.key === "ArrowRight") deltaX = amount;
    if (event.key === "ArrowUp") deltaY = -amount;
    if (event.key === "ArrowDown") deltaY = amount;
    if (!deltaX && !deltaY) return;
    event.preventDefault();
    updateAvatarDraft((current) => ({
      ...current,
      offsetX: current.offsetX + deltaX,
      offsetY: current.offsetY + deltaY,
    }));
  };

  const saveAvatar = async () => {
    if (!profile || !avatarDraft || uploadingAvatar || removingAvatar) return;
    setUploadingAvatar(true);
    setNotice(null);
    try {
      if (!cropImageRef.current) throw new Error("IMAGE_NOT_READY");
      const dataUrl = createAvatarCropDataUrl(cropImageRef.current, avatarDraft);
      const { url } = await api.uploadAccountAvatar({ fileName: "avatar.png", dataUrl });
      applyUserUpdate({ ...profile.user, avatar_url: url });
      avatarDragRef.current = null;
      cropImageRef.current = null;
      setAvatarDraft(null);
      setAvatarDialogOpen(false);
      setNotice({ kind: "success", message: "头像已更新。" });
    } catch (error) {
      setNotice({ kind: "error", message: accountErrorMessage(error, "头像处理或上传失败，请重试。") });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    if (!profile || uploadingAvatar || removingAvatar) return;
    setRemovingAvatar(true);
    setNotice(null);
    try {
      await api.deleteAccountAvatar();
      applyUserUpdate({ ...profile.user, avatar_url: null });
      avatarDragRef.current = null;
      cropImageRef.current = null;
      setAvatarDraft(null);
      setAvatarDialogOpen(false);
      setNotice({ kind: "success", message: "头像已删除。" });
    } catch (error) {
      setNotice({ kind: "error", message: accountErrorMessage(error, "头像删除失败，请稍后重试。") });
    } finally {
      setRemovingAvatar(false);
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setNotice(null);
    try {
      await logout();
      navigateTo("/", { replace: true });
    } catch {
      setNotice({ kind: "error", message: "退出登录失败，请稍后重试。" });
      setLoggingOut(false);
    }
  };

  const displayAvatar = profile?.user.avatar_url ?? null;
  const cropLayout = avatarDraft ? getAvatarCropLayout(avatarDraft) : null;

  return (
    <main className="dashboard-content account-page">
      <WorkspacePageHero
        eyebrow="账号设置"
        title="个人资料"
        description="管理你的身份信息、简历和当前会话。"
      />

      {loading && <PageLoading label="正在加载个人资料…" />}

      {!loading && loadFailed && !profile && (
        <section className="account-state" role="alert">
          <UserRound aria-hidden size={28} />
          <div>
            <h2>暂时无法读取个人资料</h2>
            <p>请检查网络连接后重新加载。</p>
          </div>
          <Button variant="secondary" onClick={() => window.location.reload()}>重新加载</Button>
        </section>
      )}

      {profile && (
        <div className="account-layout">
          <section className="account-settings" aria-label="账号设置">
            <section className="account-section account-identity-section" aria-labelledby="account-identity-heading">
              <div className="account-identity">
                <button
                  type="button"
                  className="account-avatar-trigger"
                  aria-label={profile.user.avatar_url ? "更换头像" : "设置头像"}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Avatar className="account-avatar-lg">
                    <AvatarImage alt="" className="object-cover" src={displayAvatar ?? undefined} />
                    <AvatarFallback className="account-avatar-lg-fallback">
                      {profileInitial(profile.user.nickname)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="account-avatar-edit-overlay" aria-hidden="true">
                    <span className="account-avatar-edit-mark"><Pencil size={17} /></span>
                  </span>
                </button>
                <div className="account-identity-text">
                  <h2 id="account-identity-heading">{profile.user.nickname}</h2>
                  <p>{profile.user.email}</p>
                </div>
                <input
                  ref={fileInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="image/*"
                  aria-label="选择头像图片"
                  tabIndex={-1}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    void pickAvatarFile(file);
                  }}
                />
              </div>
            </section>

            <section className="account-section" aria-labelledby="account-personal-heading">
              <header className="account-section-heading">
                <h2 id="account-personal-heading">个人信息</h2>
              </header>
              <div className="account-setting-rows">
                <div className="account-setting-row">
                  <div className="account-field-label">
                    <Label htmlFor="account-nickname">昵称</Label>
                    <p>用于工作区中的身份展示</p>
                  </div>
                  <div className="account-field-content">
                    <Input
                      id="account-nickname"
                      value={nickname}
                      maxLength={MAX_NICKNAME_LENGTH}
                      aria-describedby="account-nickname-hint"
                      onChange={(event) => setNickname(event.target.value)}
                    />
                    <span id="account-nickname-hint" className="sr-only">最多 {MAX_NICKNAME_LENGTH} 个字符</span>
                  </div>
                  <Button
                    className="account-field-action"
                    size="sm"
                    variant="ghost"
                    disabled={savingName || nickname.trim() === profile.user.nickname}
                    onClick={() => void saveNickname()}
                  >
                    {savingName ? "保存中..." : "保存昵称"}
                  </Button>
                </div>

                <div className="account-setting-row">
                  <div className="account-field-label">
                    <span className="account-field-name">登录邮箱</span>
                    <p>当前暂不支持修改</p>
                  </div>
                  <p className="account-field-content account-email-value">{profile.user.email}</p>
                  <span className="account-field-action-spacer" aria-hidden="true" />
                </div>
              </div>
            </section>

            <section className="account-section" aria-labelledby="account-resumes-heading">
              <header className="account-section-heading account-resumes-heading">
                <div className="account-section-title-group">
                  <h2 id="account-resumes-heading">简历</h2>
                  <p className="account-resume-summary">共 <strong>{profile.resume_count}</strong> 份</p>
                </div>
                <button type="button" className="account-text-link" onClick={() => navigateTo("/resumes")}>
                  查看全部
                </button>
              </header>
              <div className="account-recent-block">
                <p className="account-subsection-label">最近更新</p>
                <ul className="account-recent-list">
                  {profile.recent_resumes.length === 0 && (
                    <li className="account-recent-empty">暂无简历</li>
                  )}
                  {profile.recent_resumes.map((resume) => (
                    <li key={resume.id}>
                      <button
                        type="button"
                        className="account-recent-row"
                        onClick={() => navigateTo(editorPath(String(resume.id)))}
                      >
                        <span className="account-recent-text">
                          <strong>{resume.title}</strong>
                          <small>{recentTime(resume.updated_at)}</small>
                        </span>
                        <ChevronRight aria-hidden size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="account-section account-session-section" aria-labelledby="account-session-heading">
              <header className="account-section-heading">
                <h2 id="account-session-heading">当前会话</h2>
              </header>
              <div className="account-setting-rows">
                <div className="account-setting-row account-session-row">
                  <div className="account-field-label">
                    <span className="account-field-name">此设备</span>
                    <p>退出后需要重新登录</p>
                  </div>
                  <p className="account-field-content account-session-description">当前登录会话</p>
                  <Button
                    className="account-danger-text"
                    size="sm"
                    variant="ghost"
                    disabled={loggingOut}
                    onClick={() => void handleLogout()}
                  >
                    {loggingOut ? "正在退出…" : "退出登录"}
                  </Button>
                </div>
              </div>
            </section>
          </section>

          <Dialog open={avatarDialogOpen} onOpenChange={handleAvatarDialogOpenChange}>
            {avatarDraft && (
              <DialogContent
                className="account-avatar-dialog"
                data-uploading={uploadingAvatar || removingAvatar ? "true" : "false"}
                aria-busy={uploadingAvatar || removingAvatar}
              >
                <DialogHeader>
                  <DialogTitle>调整头像</DialogTitle>
                  <DialogDescription>拖动图片调整位置，使用滑块缩放，圆形区域将作为头像。</DialogDescription>
                </DialogHeader>

                <div className="account-avatar-dialog-body">
                  <div
                    className="account-avatar-crop-viewport"
                    role="group"
                    tabIndex={0}
                    aria-label="头像裁剪区域，可使用方向键移动"
                    onKeyDown={handleCropKeyDown}
                    onPointerDown={handleCropPointerDown}
                    onPointerMove={handleCropPointerMove}
                    onPointerUp={handleCropPointerEnd}
                    onPointerCancel={handleCropPointerEnd}
                  >
                    <img
                      ref={cropImageRef}
                      className="account-avatar-crop-image"
                      src={avatarDraft.dataUrl}
                      alt=""
                      draggable={false}
                      style={{
                        width: `${cropLayout?.renderedWidth ?? AVATAR_CROP_VIEWPORT_SIZE}px`,
                        height: `${cropLayout?.renderedHeight ?? AVATAR_CROP_VIEWPORT_SIZE}px`,
                        transform: `translate(-50%, -50%) translate(${avatarDraft.offsetX}px, ${avatarDraft.offsetY}px)`,
                      }}
                    />
                    <span className="account-avatar-crop-shade" aria-hidden="true" />
                    <span className="account-avatar-crop-window" aria-hidden="true" />
                  </div>

                  <label className="account-avatar-zoom-control" htmlFor="account-avatar-zoom">
                    <span>缩放</span>
                    <input
                      id="account-avatar-zoom"
                      type="range"
                      min={AVATAR_CROP_MIN_ZOOM}
                      max={AVATAR_CROP_MAX_ZOOM}
                      step="0.01"
                      value={avatarDraft.zoom}
                      disabled={uploadingAvatar || removingAvatar}
                      onChange={(event) => {
                        const zoom = Number(event.currentTarget.value);
                        updateAvatarDraft((current) => ({ ...current, zoom }));
                      }}
                    />
                    <output>{avatarDraft.zoom.toFixed(1)}x</output>
                  </label>

                  {profile.user.avatar_url && (
                    <button
                      type="button"
                      className="account-avatar-dialog-delete"
                      disabled={uploadingAvatar || removingAvatar}
                      onClick={() => void removeAvatar()}
                    >
                      {removingAvatar ? "删除中…" : "删除当前头像"}
                    </button>
                  )}
                </div>

                <DialogFooter className="account-avatar-dialog-footer">
                  <Button variant="ghost" disabled={uploadingAvatar || removingAvatar} onClick={discardAvatarDraft}>
                    取消
                  </Button>
                  <Button variant="accent" disabled={uploadingAvatar || removingAvatar} onClick={() => void saveAvatar()}>
                    {uploadingAvatar ? "保存中…" : "确定"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            )}
          </Dialog>
        </div>
      )}

      {notice && <FeedbackNotice kind={notice.kind}>{notice.message}</FeedbackNotice>}
    </main>
  );
}

function profileInitial(nickname: string) {
  return Array.from(nickname.trim())[0] ?? "?";
}

function recentTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const startOfDay = (target: Date) => new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return "今天更新";
  if (diffDays === 1) return "昨天更新";
  return `${date.getMonth() + 1}月${date.getDate()}日更新`;
}
