import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, MessageCircle, UserRound } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  FeedbackNotice,
  Input,
  Label,
  Separator,
  Skeleton,
} from "@/components/ui";
import { api, AccountProfile, ApiRequestError, UserProfile } from "../../api/client";
import { editorPath, navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
const MAX_NICKNAME_LENGTH = 50;
const BIND_POLL_INTERVAL_MS = 3000;
type Notice = { kind: "success" | "error"; message: string } | null;

export function accountErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    if (error.message === "INVALID_NICKNAME") return `昵称不能为空，且不能超过 ${MAX_NICKNAME_LENGTH} 个字符。`;
    if (error.message === "INVALID_IMAGE") return "请选择有效的图片文件。";
    if (error.message === "IMAGE_TOO_LARGE") return "头像图片不能超过 10MB。";
    if (error.message === "WECHAT_SERVICE_UNAVAILABLE") return "微信绑定服务暂不可用，请稍后重试。";
    if (error.message === "WECHAT_ALREADY_BOUND") return "该微信已绑定其他账号。";
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
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [bindTicket, setBindTicket] = useState<string | null>(null);
  const [bindQrcode, setBindQrcode] = useState<string | null>(null);
  const [requestingBind, setRequestingBind] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const wechatBound = profile?.user.wechat_status === "bound";

  const refreshProfile = async () => {
    const data = await api.getAccountProfile();
    setProfile(data);
    setNickname(data.user.nickname);
    syncProfile(data.user);
  };

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
    if (!bindTicket || wechatBound) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const { status } = await api.getWechatBindStatus(bindTicket);
          if (cancelled) return;
          if (status === "bound") {
            window.clearInterval(timer);
            setBindTicket(null);
            setBindQrcode(null);
            await refreshProfile();
          } else if (status === "expired") {
            window.clearInterval(timer);
            setBindTicket(null);
            setBindQrcode(null);
            setNotice({ kind: "error", message: "二维码已过期，请重新发起绑定。" });
          }
        } catch {
          // Transient polling failures are retried on the next tick.
        }
      })();
    }, BIND_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [bindTicket, wechatBound]);

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

  const pickAvatarFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setNotice({ kind: "error", message: "头像图片不能超过 10MB。" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (!dataUrl) return;
      setAvatarPreview(dataUrl);
      setNotice(null);
    };
    reader.readAsDataURL(file);
  };

  const cancelAvatarPreview = () => {
    setAvatarPreview(null);
    setNotice(null);
  };

  const saveAvatar = async () => {
    if (!profile || !avatarPreview) return;
    setUploadingAvatar(true);
    setNotice(null);
    try {
      const { url } = await api.uploadAccountAvatar({ fileName: "avatar.png", dataUrl: avatarPreview });
      applyUserUpdate({ ...profile.user, avatar_url: url });
      setAvatarPreview(null);
      setNotice({ kind: "success", message: "头像已更新。" });
    } catch (error) {
      setAvatarPreview(null);
      setNotice({ kind: "error", message: accountErrorMessage(error, "头像上传失败，请稍后重试。") });
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
      setNotice({ kind: "success", message: "头像已删除。" });
    } catch (error) {
      setNotice({ kind: "error", message: accountErrorMessage(error, "头像删除失败，请稍后重试。") });
    } finally {
      setRemovingAvatar(false);
    }
  };

  const handleStartBind = async () => {
    if (!profile || requestingBind) return;
    setRequestingBind(true);
    setNotice(null);
    try {
      const { ticket, qrcode_data } = await api.requestWechatBind();
      setBindTicket(ticket);
      setBindQrcode(qrcode_data);
    } catch (error) {
      setNotice({ kind: "error", message: accountErrorMessage(error, "发起绑定失败，请稍后重试。") });
    } finally {
      setRequestingBind(false);
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

  const displayAvatar = avatarPreview ?? profile?.user.avatar_url ?? null;

  return (
    <main className="dashboard-content account-page">
      <header className="dashboard-header account-header">
        <div className="mx-auto w-full max-w-[756px]">
          <h1>个人资料</h1>
        </div>
      </header>

      {loading && <AccountPageSkeleton />}

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
        <div className="mx-auto w-full max-w-[820px] px-5 py-8 sm:px-8 sm:py-10">
          <section className="overflow-hidden rounded-xl border border-border bg-surface" aria-label="账号设置">
            <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
              <Avatar className="size-16 shrink-0 border border-border bg-muted">
                <AvatarImage alt="当前头像" className="object-cover" src={displayAvatar ?? undefined} />
                <AvatarFallback className="bg-primary text-xl font-semibold text-primary-foreground">
                  {profileInitial(profile.user.nickname)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <h3 className="m-0 truncate text-base font-semibold">{profile.user.nickname}</h3>
                <p className="mb-0 mt-1 truncate text-sm text-muted-foreground">{profile.user.email}</p>
                {avatarPreview && (
                  <p className="mb-0 mt-1 text-xs font-medium text-warning">新头像已预览，尚未保存</p>
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
                  pickAvatarFile(file);
                }}
              />
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                {avatarPreview ? (
                  <>
                    <Button size="sm" disabled={uploadingAvatar} onClick={() => void saveAvatar()}>
                      {uploadingAvatar ? "保存中..." : "保存新头像"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={uploadingAvatar} onClick={cancelAvatarPreview}>
                      取消
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={uploadingAvatar || removingAvatar}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploadingAvatar ? "上传中..." : "更换头像"}
                    </Button>
                    {profile.user.avatar_url && (
                      <Button
                        className="text-muted-foreground hover:text-destructive"
                        size="sm"
                        variant="ghost"
                        disabled={uploadingAvatar || removingAvatar}
                        onClick={() => void removeAvatar()}
                      >
                        {removingAvatar ? "移除中..." : "移除"}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            <Separator />

            <div className="divide-y divide-border">
              <div className="grid gap-4 p-5 sm:grid-cols-[160px_minmax(0,1fr)] sm:p-6">
                <div>
                  <Label htmlFor="account-nickname">昵称</Label>
                  <p className="mb-0 mt-1 text-xs leading-relaxed text-muted-foreground">用于工作区中的身份展示。</p>
                </div>
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                  <Input
                    id="account-nickname"
                    value={nickname}
                    maxLength={MAX_NICKNAME_LENGTH}
                    aria-describedby="account-nickname-hint"
                    onChange={(event) => setNickname(event.target.value)}
                  />
                  <Button
                    className="shrink-0 self-end sm:self-auto"
                    size="sm"
                    disabled={savingName || nickname.trim() === profile.user.nickname}
                    onClick={() => void saveNickname()}
                  >
                    {savingName ? "保存中..." : "保存"}
                  </Button>
                  <span id="account-nickname-hint" className="sr-only">最多 {MAX_NICKNAME_LENGTH} 个字符</span>
                </div>
              </div>

              <div className="grid gap-3 p-5 sm:grid-cols-[160px_minmax(0,1fr)] sm:p-6">
                <div>
                  <span className="text-sm font-medium">登录邮箱</span>
                  <p className="mb-0 mt-1 text-xs leading-relaxed text-muted-foreground">当前暂不支持修改。</p>
                </div>
                <p className="m-0 self-center break-all text-sm text-foreground">{profile.user.email}</p>
              </div>
            </div>
          </section>

          <section className="mt-5 overflow-hidden rounded-xl border border-border bg-surface" aria-label="使用情况">
            <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
              <div>
                <h3 className="m-0 text-sm font-semibold">简历数量</h3>
                <p className="mb-0 mt-1 text-3xl font-semibold tabular-nums">{profile.resume_count}</p>
              </div>
              <div className="min-w-0">
                <h3 className="m-0 text-sm font-semibold">最近简历</h3>
                <ul className="mb-0 mt-2 flex flex-col gap-1">
                  {profile.recent_resumes.length === 0 && (
                    <li className="text-sm text-muted-foreground">暂无简历</li>
                  )}
                  {profile.recent_resumes.map((resume) => (
                    <li key={resume.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
                        onClick={() => navigateTo(editorPath(String(resume.id)))}
                      >
                        <FileText aria-hidden size={14} className="shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{resume.title}</span>
                        <ChevronRight aria-hidden size={14} className="shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="mt-5 overflow-hidden rounded-xl border border-border bg-surface" aria-label="安全设置">
            <div className="border-b border-border bg-surface-subtle px-5 py-3 sm:px-6">
              <h3 className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">安全</h3>
            </div>

            <div className="divide-y divide-border">
              <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
                <div className="min-w-0 flex-1">
                  <h3 className="m-0 text-sm font-medium">登录密码</h3>
                  <p className="mb-0 mt-1 text-xs leading-relaxed text-muted-foreground">修改密码后，其他设备需要重新登录。</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => navigateTo("/account/password")}>修改密码</Button>
              </div>

              <WechatSection
                status={profile.user.wechat_status}
                boundAt={profile.user.wechat_bound_at}
                bindQrcode={bindQrcode}
                requesting={requestingBind}
                onStartBind={() => void handleStartBind()}
              />

              <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
                <div className="min-w-0 flex-1">
                  <h3 className="m-0 text-sm font-medium">退出当前账号</h3>
                  <p className="mb-0 mt-1 text-xs leading-relaxed text-muted-foreground">结束此设备上的当前会话。</p>
                </div>
                <Button
                  className="self-start text-destructive hover:bg-[var(--ui-destructive-subtle)] hover:text-destructive sm:self-auto"
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
        </div>
      )}

      {notice && <FeedbackNotice kind={notice.kind}>{notice.message}</FeedbackNotice>}
    </main>
  );
}

function WechatSection({
  status,
  boundAt,
  bindQrcode,
  requesting,
  onStartBind,
}: {
  status: "unbound" | "bound" | "unavailable";
  boundAt: string | null;
  bindQrcode: string | null;
  requesting: boolean;
  onStartBind: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:p-6">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <MessageCircle aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h3 className="m-0 text-sm font-medium">微信绑定</h3>
          {status === "bound" && (
            <p className="mb-0 mt-1 text-xs leading-relaxed text-muted-foreground">
              已绑定微信{boundAt ? `（${formatBoundAt(boundAt)}）` : ""}。本周暂不支持解绑或更换。
            </p>
          )}
          {status === "unavailable" && (
            <p className="mb-0 mt-1 text-xs leading-relaxed text-muted-foreground">
              微信绑定服务暂不可用。
            </p>
          )}
          {status === "unbound" && !bindQrcode && (
            <p className="mb-0 mt-1 text-xs leading-relaxed text-muted-foreground">
              绑定微信后可通过小程序登录当前账号。
            </p>
          )}
          {status === "unbound" && bindQrcode && (
            <p className="mb-0 mt-1 text-xs leading-relaxed text-muted-foreground">
              使用微信扫描下方小程序码，在小程序内确认绑定。
            </p>
          )}
        </div>
      </div>
      {status === "unbound" && !bindQrcode && (
        <Button size="sm" variant="outline" disabled={requesting} onClick={onStartBind}>
          {requesting ? "生成中..." : "绑定微信"}
        </Button>
      )}
      {status === "unbound" && bindQrcode && (
        <img
          className="size-32 shrink-0 rounded-lg border border-border object-contain"
          src={`data:image/png;base64,${bindQrcode}`}
          alt="微信绑定二维码"
        />
      )}
    </div>
  );
}

function AccountPageSkeleton() {
  return (
    <div aria-label="正在加载个人资料" className="mx-auto w-full max-w-[820px] px-5 py-8 sm:px-8 sm:py-10" role="status">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-4 p-6">
          <Skeleton className="size-16 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-2 h-4 w-48 max-w-full" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
        <Separator />
        <div className="grid gap-6 p-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    </div>
  );
}

function profileInitial(nickname: string) {
  return Array.from(nickname.trim())[0] ?? "?";
}

function formatBoundAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
