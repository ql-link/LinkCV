import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Camera, LogOut, Pencil, UserRound } from "lucide-react";

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
  PageLoading,
} from "@/components/ui";
import { api, AccountProfile, AgentSession, ApiRequestError, UserProfile } from "../../api/client";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
import { navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";
import "./account.css";
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
import { UserProfilePanel } from "./UserProfilePanel";

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
  const [nicknameEditing, setNicknameEditing] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsFailed, setSessionsFailed] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState<AvatarCropDraft | null>(null);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [avatarPreviewOpen, setAvatarPreviewOpen] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nicknameInputRef = useRef<HTMLInputElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const avatarDragRef = useRef<AvatarDrag | null>(null);
  const avatarReadRequestRef = useRef(0);

  useEffect(() => {
    if (!notice) return;

    const timer = window.setTimeout(() => {
      setNotice(null);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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

  useEffect(() => {
    let cancelled = false;
    setSessionsLoading(true);
    setSessionsFailed(false);
    void api.listAgentSessions()
      .then((result) => {
        if (!cancelled) setSessions(result.sessions);
      })
      .catch(() => {
        if (!cancelled) {
          setSessions([]);
          setSessionsFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (nicknameEditing) {
      nicknameInputRef.current?.focus();
      nicknameInputRef.current?.select();
    }
  }, [nicknameEditing]);

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
      setNicknameEditing(false);
    } catch (error) {
      setNotice({ kind: "error", message: accountErrorMessage(error, "昵称保存失败，请稍后重试。") });
    } finally {
      setSavingName(false);
    }
  };

  const startNicknameEdit = () => {
    if (!profile) return;
    setNickname(profile.user.nickname);
    setNicknameEditing(true);
    setNotice(null);
  };

  const cancelNicknameEdit = () => {
    if (profile) setNickname(profile.user.nickname);
    setNicknameEditing(false);
    setNotice(null);
  };

  const handleNicknameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelNicknameEdit();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void saveNickname();
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

  const handleLogoutDialogOpenChange = (open: boolean) => {
    if (!open && loggingOut) return;
    setLogoutDialogOpen(open);
  };

  const displayAvatar = profile?.user.avatar_url ?? null;
  const cropLayout = avatarDraft ? getAvatarCropLayout(avatarDraft) : null;

  const openAvatarPreview = () => {
    if (displayAvatar) setAvatarPreviewOpen(true);
  };

  return (
    <main className="dashboard-content account-page">
      <WorkspacePageHero
        eyebrow=""
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
          <div className="account-overview-grid">
            <aside className="account-profile-card" aria-label="个人资料摘要">
              <div className="account-profile-banner" aria-hidden="true" />
              <div className="account-profile-card-body">
                <div className="account-avatar-control">
                  <button
                    type="button"
                    className="account-avatar-trigger"
                    aria-label={displayAvatar ? "查看头像原图" : "头像预览不可用"}
                    disabled={!displayAvatar}
                    onClick={openAvatarPreview}
                  >
                    <Avatar className="account-avatar-lg">
                      <AvatarImage alt="" className="object-cover" src={displayAvatar ?? undefined} />
                      <AvatarFallback className="account-avatar-lg-fallback">
                        {profileInitial(profile.user.nickname)}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                  <button
                    type="button"
                    className="account-avatar-edit-trigger"
                    aria-label="修改头像"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Camera aria-hidden size={16} />
                  </button>
                </div>

                <div className="account-identity-section">
                  {nicknameEditing ? (
                    <form
                      className="account-nickname-edit-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveNickname();
                      }}
                    >
                      <Input
                        ref={nicknameInputRef}
                        id="account-nickname"
                        className="account-nickname-input"
                        aria-label="昵称"
                        value={nickname}
                        maxLength={MAX_NICKNAME_LENGTH}
                        aria-describedby="account-nickname-hint"
                        onChange={(event) => setNickname(event.target.value)}
                        onKeyDown={handleNicknameKeyDown}
                        onBlur={cancelNicknameEdit}
                        disabled={savingName}
                      />
                      <span id="account-nickname-hint" className="sr-only">最多 {MAX_NICKNAME_LENGTH} 个字符，按 Enter 保存，按 Escape 取消</span>
                    </form>
                  ) : (
                    <div className="account-nickname-view">
                      <h2
                        id="account-identity-heading"
                        className="cursor-pointer"
                        title="点击修改昵称"
                        onClick={startNicknameEdit}
                      >
                        {profile.user.nickname}
                      </h2>
                      <button
                        type="button"
                        className="account-nickname-edit-trigger"
                        aria-label="修改昵称"
                        onClick={startNicknameEdit}
                      >
                        <Pencil aria-hidden size={14} />
                      </button>
                    </div>
                  )}
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

              <div className="account-profile-stats" aria-label="账户统计">
                <div className="account-profile-stat">
                  <span>简历资产</span>
                  <strong>{profile.resume_count}</strong>
                </div>
                <div className="account-profile-stat">
                  <span>AI 对话</span>
                  <strong>{sessionsLoading ? "…" : sessionsFailed ? "—" : sessions.length >= 50 ? "50+" : sessions.length}</strong>
                </div>
              </div>

              <div className="account-profile-actions">
                <Button
                  className="account-danger-text account-logout-btn"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setNotice(null);
                    setLogoutDialogOpen(true);
                  }}
                >
                  <LogOut aria-hidden size={15} />
                  退出登录
                </Button>
              </div>
            </aside>

            <main className="account-main-content">
              <UserProfilePanel />
            </main>
          </div>

          {displayAvatar && (
            <Dialog open={avatarPreviewOpen} onOpenChange={setAvatarPreviewOpen}>
              <DialogContent className="account-avatar-preview-dialog" aria-describedby={undefined}>
                <DialogTitle className="sr-only">查看头像原图</DialogTitle>
                <img className="account-avatar-preview-image" src={displayAvatar} alt="头像原图" />
              </DialogContent>
            </Dialog>
          )}

          <Dialog open={avatarDialogOpen} onOpenChange={handleAvatarDialogOpenChange}>
            {avatarDraft && (
              <DialogContent
                className="account-avatar-dialog"
                data-uploading={uploadingAvatar || removingAvatar ? "true" : "false"}
                aria-busy={uploadingAvatar || removingAvatar}
              >
                <DialogHeader className="account-avatar-dialog-header">
                  <DialogTitle className="account-avatar-dialog-title">调整头像</DialogTitle>
                  <DialogDescription className="account-avatar-dialog-desc">
                    拖动或缩放图片以调整圆形头像区域
                  </DialogDescription>
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

                  <label className="account-avatar-zoom-row" htmlFor="account-avatar-zoom">
                    <span className="account-avatar-zoom-label">缩放</span>
                    <input
                      id="account-avatar-zoom"
                      className="account-avatar-zoom-slider"
                      type="range"
                      aria-label="缩放"
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
                    <span className="account-avatar-zoom-value">{avatarDraft.zoom.toFixed(1)}x</span>
                  </label>
                </div>

                <DialogFooter className="account-avatar-dialog-footer">
                  <Button
                    variant="default"
                    size="sm"
                    className="account-avatar-save-btn"
                    disabled={uploadingAvatar || removingAvatar}
                    onClick={() => void saveAvatar()}
                  >
                    {uploadingAvatar ? "保存中…" : "确定"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            )}
          </Dialog>

          <Dialog open={logoutDialogOpen} onOpenChange={handleLogoutDialogOpenChange}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>确认退出登录</DialogTitle>
                <DialogDescription>退出后需要重新登录。</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="ghost"
                  disabled={loggingOut}
                  onClick={() => setLogoutDialogOpen(false)}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  disabled={loggingOut}
                  onClick={() => void handleLogout()}
                >
                  {loggingOut ? "正在退出…" : "退出登录"}
                </Button>
              </DialogFooter>
            </DialogContent>
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
