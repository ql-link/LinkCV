import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link2Off, Printer } from "lucide-react";
import { Brand, Button, PageLoading } from "@/components/ui";
import { api, type PublicSharePayload } from "../../api/client";
import { resumeDocumentTitle } from "../../api/resumeContract";
import "../preview/print/resume-print.css";
import { renderResumePrintDocument } from "../preview/print/resumePrintDocument";

declare global {
  interface Window {
    WeixinJSBridge?: {
      invoke: (name: string, params: Record<string, string>) => void;
    };
  }
}

function ShareBrand() {
  return <Brand className="share-brand" label="linkresume" name="linkresume" />;
}

type ShareStatus = "loading" | "ready" | "unavailable";

// A4 纸面固定 210mm ≈ 794 CSS px（210 * 96 / 25.4）
const PAPER_WIDTH_PX = 794;
const MIN_PAPER_SCALE = 0.2;

function supportsCssZoom() {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("zoom", "1")
  );
}

type PaperFit = {
  scale: number;
  // transform 回退路径下纸面的占位高度（缩放后）；zoom 路径由布局自动收缩，为 null
  height: number | null;
};

// 纸面缩放以滚动容器的实际内容宽度为准；CSS zoom 不可用时回退 transform: scale
function usePaperFit(active: boolean) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<PaperFit>({ scale: 1, height: null });
  const zoomSupported = useMemo(supportsCssZoom, []);

  useLayoutEffect(() => {
    if (!active) return;
    const wrap = wrapRef.current;
    const scroll = wrap?.parentElement;
    if (!wrap || !scroll) return;
    const update = () => {
      const styles = getComputedStyle(scroll);
      const available =
        scroll.clientWidth -
        parseFloat(styles.paddingLeft) -
        parseFloat(styles.paddingRight);
      const scale = Math.min(
        1,
        Math.max(MIN_PAPER_SCALE, available / PAPER_WIDTH_PX),
      );
      // transform 不改变布局尺寸，需要显式给出缩放后的占位高度
      const inner = innerRef.current;
      const height =
        zoomSupported || !inner ? null : inner.offsetHeight * scale;
      setFit((prev) =>
        prev.scale === scale && prev.height === height ? prev : { scale, height },
      );
    };
    update();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(scroll);
    if (innerRef.current) observer?.observe(innerRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [zoomSupported, active]);

  return { wrapRef, innerRef, fit, zoomSupported };
}

// 微信 Android 内置浏览器按微信“字体大小”设置放大页面文字：固定 210mm 纸面内
// 字号被抬高后会整体重排变形。官方 JSAPI 可将本页字号恢复为标准档。
function useRestoreStandardFontSize() {
  useEffect(() => {
    const restore = () => {
      window.WeixinJSBridge?.invoke("setFontSizeCallback", { fontSize: "2" });
    };
    restore();
    document.addEventListener("WeixinJSBridgeReady", restore);
    return () => document.removeEventListener("WeixinJSBridgeReady", restore);
  }, []);
}

export function SharePage({ token }: { token: string }) {
  const [payload, setPayload] = useState<PublicSharePayload | null>(null);
  const [status, setStatus] = useState<ShareStatus>("loading");
  const { wrapRef, innerRef, fit, zoomSupported } = usePaperFit(
    status === "ready" && payload !== null,
  );
  useRestoreStandardFontSize();

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setStatus("loading");
    void api
      .fetchPublicShare(token)
      .then((result) => {
        if (cancelled) return;
        setPayload(result);
        setStatus("ready");
      })
      .catch(() => {
        // token 不存在、已过期、已删除或无权查看统一视为失效。
        if (!cancelled) setStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const documentHtml = useMemo(
    () => payload
      ? renderResumePrintDocument({
        title: resumeDocumentTitle(payload.data) || "LinkResume Resume",
        data: payload.data,
        style: payload.style,
        layout_plan: payload.layout_plan,
      }, { className: "share-page-paper", ariaLabel: "分享简历内容" })
      : "",
    [payload],
  );

  if (status === "loading") {
    return <PageLoading label="正在加载分享内容…" scope="page" />;
  }

  if (status === "unavailable" || !payload) {
    return (
      <main className="share-unavailable">
        <ShareBrand />
        <section className="share-unavailable-card">
          <span className="share-unavailable-icon" aria-hidden="true">
            <Link2Off size={22} strokeWidth={1.8} />
          </span>
          <h1>这条分享链接已失效</h1>
          <p>链接可能已过期、被重新生成，或由分享者主动关闭。你可以联系分享者获取新的链接。</p>
          <Button variant="outline" onClick={() => window.location.assign("/")}>返回 LinkResume 首页</Button>
        </section>
      </main>
    );
  }

  const wrapStyle: React.CSSProperties = zoomSupported
    ? ({ zoom: fit.scale } as React.CSSProperties)
    : {
        width: PAPER_WIDTH_PX * fit.scale,
        height: fit.height ?? undefined,
        overflow: "hidden",
      };
  const innerStyle: React.CSSProperties = zoomSupported
    ? {}
    : {
        width: PAPER_WIDTH_PX,
        transform: `scale(${fit.scale})`,
        transformOrigin: "top left",
      };

  return (
    <main className="share-page">
      <header className="share-page-header">
        <ShareBrand />
        <span className="share-page-header-note">
          由 {payload.sharer.nickname} 分享
        </span>
        <span className="share-page-header-actions">
          <Button variant="outline" size="sm" icon={<Printer size={14} />} onClick={() => window.print()}>
            打印
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            下载 PDF
          </Button>
        </span>
      </header>
      <section className="share-page-paper-scroll">
        <div
          ref={wrapRef}
          className="share-page-paper-wrap"
          style={wrapStyle}
        >
          <div
            ref={innerRef}
            className="share-page-paper-inner"
            style={innerStyle}
            dangerouslySetInnerHTML={{ __html: documentHtml }}
          />
        </div>
      </section>
      <footer className="share-page-footer">由 linkresume 生成</footer>
    </main>
  );
}
