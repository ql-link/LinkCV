import { useEffect, useRef, useState } from "react";
import { Camera, ChevronRight, FileText, KeyRound, LogOut, MessageCircle, Trash2 } from "lucide-react";
import { api, AccountProfile, ApiRequestError } from "../../api/client";
import { Button, TextInput, Toast } from "../../components/ds";
import { editorPath, navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";
import { WechatQrLogin } from "../auth/WechatQrLogin";

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
const MAX_NICKNAME_LENGTH = 50;

type Notice = { kind: "success" | "error"; message: string } | null;

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
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [wechatDialogOpen, setWechatDialogOpen] = useState(false);
  const [wechatBound, setWechatBound] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const applyUserUpdate = (user: AccountProfile["user"]) => {
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
      void uploadAvatar(dataUrl, file.name);
    };
    reader.readAsDataURL(file);
  };

  const uploadAvatar = async (dataUrl: string, fileName: string) => {
    if (!profile) return;
    setUploadingAvatar(true);
    setNotice(null);
    try {
      const { url } = await api.uploadAccountAvatar({ fileName, dataUrl });
      applyUserUpdate({ ...profile.user, avatar_url: url });
      setNotice({ kind: "success", message: "头像已更新。" });
    } catch (error) {
      setNotice({ kind: "error", message: accountErrorMessage(error, "头像上传失败，请稍后重试。") });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    if (!profile || uploadingAvatar) return;
    setNotice(null);
    try {
      await api.deleteAccountAvatar();
      applyUserUpdate({ ...profile.user, avatar_url: null });
      setNotice({ kind: "success", message: "头像已删除。" });
    } catch (error) {
      setNotice({ kind: "error", message: accountErrorMessage(error, "头像删除失败，请稍后重试。") });
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

  return (
    <main className="dashboard-content account-page">
      <header className="dashboard-header account-header">
        <h1>个人资料</h1>
      </header>

      {loading && <div className="app-loading">正在加载资料...</div>}

      {!loading && loadFailed && !profile && (
        <div className="account-state">
          <p>资料加载失败，请稍后重试。</p>
          <Button variant="secondary" onClick={() => window.location.reload()}>重新加载</Button>
        </div>
      )}

      {profile && (
        <div className="account-body">
          <section className="account-card">
            <div className="account-avatar-row">
              <span className="account-avatar">
                {profile.user.avatar_url ? (
                  <img src={profile.user.avatar_url} alt="当前头像" />
                ) : (
                  <span className="account-avatar-fallback">{[...profile.user.nickname][0] ?? "?"}</span>
                )}
              </span>
              <div className="account-avatar-actions">
                <input
                  ref={fileInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="image/*"
                  aria-label="选择头像图片"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    pickAvatarFile(file);
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Camera size={14} />}
                  disabled={uploadingAvatar}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadingAvatar ? "上传中..." : "更换头像"}
                </Button>
                {profile.user.avatar_url && (
                  <Button variant="text" size="sm" icon={<Trash2 size={14} />} onClick={() => void removeAvatar()}>
                    删除头像
                  </Button>
                )}
              </div>
            </div>

            <div className="account-fields">
              <TextInput
                label="昵称"
                value={nickname}
                maxLength={MAX_NICKNAME_LENGTH}
                hint={`最多 ${MAX_NICKNAME_LENGTH} 个字符`}
                onChange={(event) => setNickname(event.target.value)}
              />
              <div className="account-field-save">
                <Button
                  size="sm"
                  disabled={savingName || nickname.trim() === profile.user.nickname}
                  onClick={() => void saveNickname()}
                >
                  {savingName ? "保存中..." : "保存昵称"}
                </Button>
              </div>
              <TextInput label="登录邮箱" value={profile.user.email ?? ""} readOnly disabled hint={profile.user.email ? "邮箱是登录账号，暂不支持修改" : "微信登录账号暂无邮箱"} />
            </div>
          </section>

          <section className="account-card account-usage-card">
            <h2>使用概况</h2>
            <div className="account-stat-grid">
              <div className="account-stat">
                <FileText size={18} aria-hidden="true" />
                <strong>{profile.resume_count}</strong>
                <span>简历数量</span>
              </div>
            </div>
            {profile.recent_resumes.length > 0 && (
              <div className="account-recent">
                <h3>最近编辑</h3>
                <ul>
                  {profile.recent_resumes.map((resume) => (
                    <li key={resume.id}>
                      <button type="button" onClick={() => navigateTo(editorPath(resume.id))}>
                        <span>{resume.title}</span>
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="account-card account-security-card">
            <h2>账号安全</h2>
            <button
              type="button"
              className="account-security-link"
              onClick={() => setWechatDialogOpen(true)}
            >
              <MessageCircle size={16} aria-hidden="true" />
              <span>
                <strong>微信绑定</strong>
                <small>{wechatBound ? "已绑定微信，可用微信扫码登录" : "绑定后可用微信扫码登录当前账号"}</small>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button type="button" className="account-security-link" onClick={() => navigateTo("/account/password")}>
              <KeyRound size={16} aria-hidden="true" />
              <span>
                <strong>修改密码</strong>
                <small>修改后所有设备需要重新登录</small>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="account-security-link account-logout-link"
              disabled={loggingOut}
              onClick={() => void handleLogout()}
            >
              <LogOut size={16} aria-hidden="true" />
              <span>
                <strong>{loggingOut ? "正在退出…" : "退出登录"}</strong>
                <small>退出当前账号</small>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </section>
        </div>
      )}

      {wechatDialogOpen && (
        <div
          className="home-confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setWechatDialogOpen(false);
          }}
        >
          <section
            className="home-confirm-dialog wechat-bind-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="绑定微信"
          >
            <div className="home-confirm-copy">
              <h2>{wechatBound ? "已绑定微信" : "绑定微信"}</h2>
              <p>{wechatBound ? "当前账号已绑定微信，可以使用微信扫码登录。" : "使用微信扫一扫，在手机上确认后即可完成绑定。"}</p>
            </div>
            {!wechatBound && (
              <WechatQrLogin
                mode="bind"
                onSuccess={() => {
                  setWechatBound(true);
                  setNotice({ kind: "success", message: "微信绑定成功。" });
                }}
              />
            )}
            <div className="home-confirm-actions">
              <Button variant="secondary" onClick={() => setWechatDialogOpen(false)}>
                {wechatBound ? "完成" : "取消"}
              </Button>
            </div>
          </section>
        </div>
      )}

      {notice && <Toast kind={notice.kind}>{notice.message}</Toast>}
    </main>
  );
}
