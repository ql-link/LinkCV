import { useEffect, useRef, useState } from "react";
import { RefreshCw, ScanLine } from "lucide-react";
import { api, ApiRequestError, User } from "../../api/client";
import { Button } from "@/components/ui";

const POLL_INTERVAL_MS = 2000;
let qrRequestInFlight: ReturnType<typeof api.wechatQrcode> | null = null;

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

export function WechatQrLogin({ onSuccess }: WechatQrLoginProps) {
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
      setMessage(wechatErrorMessage(error, "二维码生成失败，请稍后重试。"));
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
        setMessage("二维码已过期，请刷新后重新扫码。");
      }
      if (result.status === "cancelled") {
        stopPolling();
        setPhase("cancelled");
        setMessage("已在小程序中取消本次登录，请刷新二维码后重试。");
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

  return (
    <div className="wechat-qr-panel">
      <div className={`wechat-qr-box is-${phase}`}>
        {phase === "loading" && <span className="wechat-qr-loading">正在生成二维码...</span>}
        {phase === "waiting" && (
          <img
            className="wechat-qr-img"
            src={`data:image/png;base64,${qrBase64}`}
            alt="微信扫码登录二维码"
          />
        )}
        {(phase === "expired" || phase === "cancelled") && (
          <div className="wechat-qr-fallback">
            <ScanLine size={26} aria-hidden="true" />
            <span>{phase === "cancelled" ? "登录已取消" : "二维码已过期"}</span>
          </div>
        )}
        {phase === "error" && (
          <div className="wechat-qr-fallback">
            <ScanLine size={26} aria-hidden="true" />
            <span>二维码暂时无法生成</span>
          </div>
        )}
      </div>

      <p className="wechat-qr-hint">
        {phase === "waiting" ? "使用微信扫一扫，扫码确认后自动登录。" : message}
      </p>

      {(phase === "expired" || phase === "cancelled" || phase === "error") && (
        <Button variant="outline" size="sm" onClick={() => void loadQr()}>
          <RefreshCw size={14} /> 刷新二维码
        </Button>
      )}
    </div>
  );
}

export function wechatErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    if (error.message === "WECHAT_RATE_LIMITED") return "请求太频繁，请稍后再试。";
    if (error.message === "WECHAT_QRCODE_FAILED") return "微信二维码生成失败，请稍后重试。";
    if (error.message === "WECHAT_SERVICE_UNAVAILABLE") return "微信登录服务暂不可用，请稍后重试。";
    if (error.status === 401) return "登录状态已失效，请刷新页面后重试。";
    if (error.status >= 500) return "服务暂时不可用，请稍后重试。";
  }
  return fallback;
}
