import { t, useLocale } from "@/i18n";
import { useEffect, useRef, useState } from "react";
import { api, ApiRequestError, User } from "../../api/client";
import { PageLoading } from "@/components/ui";
import { Icon } from "../../v3/Icon";

const POLL_INTERVAL_MS = 2000;
let qrRequestInFlight: ReturnType<typeof api.wechatQrcode> | null = null;

// 同一时刻只发一次二维码请求（Strict Mode 下挂载两次也只拿到一张码）
function requestLoginQr() {
  if (!qrRequestInFlight) {
    qrRequestInFlight = api.wechatQrcode().finally(() => {
      qrRequestInFlight = null;
    });
  }
  return qrRequestInFlight;
}

type QrPhase = "loading" | "waiting" | "cancelled" | "expired" | "error";

type WechatQrLoginProps = {
  onSuccess: (user: User) => void;
};

// 08.3 微信扫码登录：200×200 二维码 + 两行说明；过期 / 取消 / 失败时在二维码上盖一层白色浮层，点击刷新
export function WechatQrLogin({ onSuccess }: WechatQrLoginProps) {
  useLocale();
  const [phase, setPhase] = useState<QrPhase>("loading");
  const [qrBase64, setQrBase64] = useState("");
  const [message, setMessage] = useState("");
  const sceneRef = useRef<string | null>(null);
  const pollTokenRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const loadVersionRef = useRef(0);
  const succeededRef = useRef(false);
  const onSuccessRef = useRef(onSuccess);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const stopPolling = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const loadQr = async () => {
    const loadVersion = ++loadVersionRef.current;
    stopPolling();
    succeededRef.current = false;
    setPhase("loading");
    setMessage("");
    try {
      const { scene, poll_token, qr_base64 } = await requestLoginQr();
      if (loadVersion !== loadVersionRef.current) return;
      sceneRef.current = scene;
      pollTokenRef.current = poll_token;
      setQrBase64(qr_base64);
      setPhase("waiting");
      timerRef.current = window.setInterval(() => {
        void pollStatus();
      }, POLL_INTERVAL_MS);
    } catch (error) {
      if (loadVersion !== loadVersionRef.current) return;
      setPhase("error");
      setMessage(wechatErrorMessage(error, t("二维码生成失败，请稍后重试。")));
    }
  };

  const pollStatus = async () => {
    const scene = sceneRef.current;
    const pollToken = pollTokenRef.current;
    if (!scene || !pollToken || succeededRef.current) return;
    try {
      const result = await api.wechatStatus(scene, pollToken);
      if (result.status === "success" && result.user) {
        stopPolling();
        succeededRef.current = true;
        onSuccessRef.current(result.user);
        return;
      }
      if (result.status === "expired") {
        stopPolling();
        setPhase("expired");
        setMessage(t("二维码已过期，请刷新后重新扫码。"));
      }
      if (result.status === "cancelled") {
        stopPolling();
        setPhase("cancelled");
        setMessage(t("已在小程序中取消本次登录，请刷新二维码后重试。"));
      }
    } catch {
      // 轮询期间网络抖动不打断等待，只对确定过期/成功切换状态。
    }
  };

  useEffect(() => {
    void loadQr();
    return () => {
      loadVersionRef.current += 1;
      stopPolling();
    };
    // 挂载时加载一次；后续刷新由用户点击触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blocked = phase === "expired" || phase === "cancelled" || phase === "error";
  const blockedTitle = phase === "cancelled" ? t("登录已取消") : phase === "error" ? t("二维码暂时无法生成") : t("二维码已过期");

  return (
    <div className="auth-qr">
      <div className={`auth-qr-box is-${phase}`} aria-live="polite">
        {phase === "loading" && <PageLoading label={t("正在生成二维码…")} scope="panel" />}
        {(phase === "waiting" || ((phase === "expired" || phase === "cancelled") && qrBase64)) && (
          <img
            className="auth-qr-img"
            fetchPriority="high"
            src={`data:image/png;base64,${qrBase64}`}
            alt={phase === "waiting" ? t("微信扫码登录二维码") : ""}
          />
        )}
        {blocked && (
          // 08.3 · 已过期：白色浮层（94% 不透明）+ 标题 + 「点击刷新」
          <button type="button" className="auth-qr-overlay" onClick={() => void loadQr()}>
            <strong>{blockedTitle}</strong>
            <span><Icon name="refresh" size={12} />{t("点击刷新")}</span>
          </button>
        )}
      </div>

      <p className={`auth-qr-hint${blocked ? " is-warn" : ""}`}>
        {phase === "waiting" || phase === "loading" ? t("使用微信扫一扫，扫码确认后自动登录。") : message}
      </p>
      <p className="auth-qr-sub">{t("扫码后在微信中确认登录，保障账号安全")}</p>
    </div>
  );
}

export function wechatErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    if (error.message === "WECHAT_RATE_LIMITED") return t("请求太频繁，请稍后再试。");
    if (error.message === "WECHAT_QRCODE_FAILED") return t("微信二维码生成失败，请稍后重试。");
    if (error.message === "WECHAT_SERVICE_UNAVAILABLE") return t("微信登录服务暂不可用，请稍后重试。");
    if (error.status === 401) return t("登录状态已失效，请刷新页面后重试。");
    if (error.status >= 500) return t("服务暂时不可用，请稍后重试。");
  }
  return fallback;
}
