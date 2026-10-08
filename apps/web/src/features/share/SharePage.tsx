import { t, useLocale, getLocale } from "@/i18n";
import { MotionPresence } from "@/components/ui/motion";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import brandWordmark from "@/assets/linkresume-wordmark.png";
import { PageLoading } from "@/components/ui";
import { api, ApiRequestError, type PublicSharePayload } from "../../api/client";
import { copyText } from "../../utils/clipboard";
import privateLock from "../../assets/figma/share-private-lock.svg";
import errorCloud from "../../assets/figma/resume-error-cloud.svg";
import { authPath } from "../../routing";
import { resumeDocumentTitle, type CanonicalContact } from "../../api/resumeContract";
import { Icon, type V3IconName } from "../../v3/Icon";
import { Toast } from "../../v3/primitives";
import { MiniResume } from "../../v3/art";
import "../../v3/v3.css";
import "./share-v3.css";
import {
  downloadPdfBlob,
  resumePdfExportErrorMessage,
  resumePdfFilename,
} from "../preview/pdfExport";
import "../preview/print/resume-print.css";
import { renderResumePrintDocument } from "../preview/print/resumePrintDocument";
import { paginateShareDocument } from "./sharePagination";
import { syncResumeSheetColumns } from "../preview/print/resumeSheetDecoration";

declare global {
  interface Window {
    WeixinJSBridge?: {
      invoke: (name: string, params: Record<string, string>) => void;
    };
  }
}

// 整窗外壳（无侧栏）：窗口底色 + 白色内容卡 + 64 高品牌栏 + 灰色画布
function shortDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function expiryNote(expiresAt: string | null | undefined) {
  const date = expiresAt ? shortDate(expiresAt) : "";
  return date ? t("公开分享 · 有效期至 {value0}", { value0: date }) : t("公开分享 · 长期有效");
}

function ShareFrame({ note, children }: { note: string; children: ReactNode }) {
  useLocale();
  return (
    <main className="v3 share-page" data-ui-theme="light">
      <div className="share-v3-card">
        <header className="share-v3-head">
          <a className="share-v3-brand" href="/" aria-label="linkresume" title={t("访问 LinkResume")}>
            <img src={brandWordmark} alt="" aria-hidden="true" />
          </a>
          <span className="share-v3-divider" aria-hidden="true" />
          <span className="share-v3-note">{note}</span>
        </header>
        <div className="share-v3-canvas">{children}</div>
      </div>
    </main>
  );
}

const CONTACT_ICON: Partial<Record<CanonicalContact["contact_kind"], V3IconName>> = {
  email: "mail",
  phone: "phone",
  website: "link",
  github: "link",
  linkedin: "link",
  location: "pin",
};

// Promo 舞台（324×120）：三张迷你简历，绿 -8° / 蓝 6° / 黑居中
function PromoArt() {
  useLocale();
  return (
    <>
      {/* Figma 旋转逆时针、绕左上角：CSS 取反 + transform-origin 0 0 */}
      <MiniResume x={96} y={18} w={64} h={86} accent="#3b8a6a" rotate={8} style={{ transformOrigin: "0 0" }} />
      <MiniResume x={170} y={18} w={64} h={86} accent="#2f5bb7" rotate={-6} style={{ transformOrigin: "0 0" }} />
      <MiniResume x={132} y={18} w={64} h={86} accent="var(--v3-dark)" />
    </>
  );
}

// 链接不可用插图（舞台 464×180）：淡掉的简历 + 断开的链条
function BrokenLinkArt() {
  useLocale();
  return (
    <span aria-hidden="true" style={{ position: "absolute", top: 0, left: "50%", width: 464, height: 180, transform: "translateX(-50%)" }}>
      <MiniResume x={182} y={24} w={100} h={132} accent="var(--v3-fnt2)" rotate={4} style={{ opacity: 0.55, boxShadow: "none", transformOrigin: "0 0" }} />
      <svg style={{ position: "absolute", left: 192, top: 60 }} width="80" height="60" viewBox="0 0 80 60" fill="none">
        <path d="M20 38a10 10 0 0 1 0-14l8-8a10 10 0 0 1 14 0" stroke="#1d1d1b" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M60 22a10 10 0 0 1 0 14l-8 8a10 10 0 0 1-14 0" stroke="#1d1d1b" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M37 30l6-6" stroke="#d64545" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 6" />
      </svg>
    </span>
  );
}

type ShareStatus = "loading" | "ready" | "unavailable" | "private" | "failed";

function ShareAccessArt({ failed }: { failed: boolean }) {
  useLocale();
  return <span aria-hidden="true" className="share-v3-access-art">
    <MiniResume x={182} y={24} w={100} h={132} accent="var(--v3-fnt2)" style={{ opacity: 0.55, boxShadow: "none" }} />
    <span className="share-v3-access-badge"><img src={failed ? errorCloud : privateLock} width={failed ? 40 : 22} height={failed ? 40 : 22} alt="" /></span>
  </span>;
}

// A4 纸面固定 210mm ≈ 794 CSS px（210 * 96 / 25.4）；设计稿里纸面显示为 600 宽
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

const SharePaperInner = memo(function SharePaperInner({
  html,
  innerRef,
  scale,
  zoomSupported,
}: {
  html: string;
  innerRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
  zoomSupported: boolean;
}) {
  const style: React.CSSProperties = zoomSupported
    ? {}
    : {
        width: PAPER_WIDTH_PX,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      };
  return (
    <div
      ref={innerRef}
      className="share-page-paper-inner"
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

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
  useLocale();
  const [payload, setPayload] = useState<PublicSharePayload | null>(null);
  const [status, setStatus] = useState<ShareStatus>("loading");
  const [pdfPending, setPdfPending] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const pdfAbortRef = useRef<AbortController | null>(null);
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
      .catch((error: unknown) => {
        if (cancelled) return;
        // 当前接口的统一 404 无法区分私密/删除/过期；仅明确拒绝访问时显示私密态。
        // 403 分支可由独立接口 fixture 验证，不通过 URL 或真实数据猜测资源可见性。
        if (error instanceof ApiRequestError && error.status === 403) setStatus("private");
        else if (error instanceof ApiRequestError && (error.status === 404 || error.status === 410)) setStatus("unavailable");
        else setStatus("failed");
      });
    return () => {
      cancelled = true;
      pdfAbortRef.current?.abort();
    };
  }, [token, loadAttempt]);

  const downloadPdf = () => {
    if (!payload || pdfPending) return;
    pdfAbortRef.current?.abort();
    const controller = new AbortController();
    pdfAbortRef.current = controller;
    setPdfPending(true);
    setPdfError(null);
    void api.downloadPublicSharePdf(token, controller.signal)
      .then((result) => {
        downloadPdfBlob(
          result.blob,
          resumePdfFilename(
            result.filename,
            resumeDocumentTitle(payload.data) || "resume",
          ),
        );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setPdfError(resumePdfExportErrorMessage(error));
        }
      })
      .finally(() => {
        if (pdfAbortRef.current === controller) {
          pdfAbortRef.current = null;
          setPdfPending(false);
        }
      });
  };

  const copyLink = () => {
    const url = window.location.href;
    void copyText(url)
      .then(() => setToast(t("链接已复制")))
      .catch(() => setToast(t("复制失败，请手动复制地址栏链接")));
  };

  const documentHtml = useMemo(
    () => payload
      ? renderResumePrintDocument({
        title: resumeDocumentTitle(payload.data) || "LinkResume Resume",
        data: payload.data,
        style: {
          ...payload.style,
          portable: {
            ...payload.style.portable,
            smart_one_page: false,
          },
        },
        layout_plan: payload.layout_plan,
        assets: payload.assets,
      }, { className: "share-page-paper", ariaLabel: t("分享简历内容") })
      : "",
    [payload, getLocale()],
  );

  useLayoutEffect(() => {
    if (status !== "ready" || !documentHtml) return;
    const paper = innerRef.current?.querySelector<HTMLElement>(".share-page-paper");
    if (!paper) return;
    let active = true;
    const paginate = () => {
      if (active && paper.isConnected) {
        setPageCount(paginateShareDocument(paper));
        syncResumeSheetColumns({ paper });
      }
    };
    paginate();
    void document.fonts?.ready.then(paginate);
    const images = Array.from(paper.querySelectorAll("img"));
    images.forEach((item) => {
      item.addEventListener("load", paginate);
      item.addEventListener("error", paginate);
    });
    return () => {
      active = false;
      images.forEach((item) => {
        item.removeEventListener("load", paginate);
        item.removeEventListener("error", paginate);
      });
    };
  }, [documentHtml, fit.height, fit.scale, innerRef, status]);

  if (status === "loading") {
    return (
      <ShareFrame note={t("公开分享")}>
        <div className="share-page-loading share-v3-loading">
          <PageLoading label={t("正在加载分享内容…")} scope="panel" />
        </div>
      </ShareFrame>
    );
  }

  if (status === "private" || status === "failed") {
    const failed = status === "failed";
    return <ShareFrame note={failed ? t("公开分享 · 暂时无法加载") : t("公开分享")}>
      <div className="share-v3-empty">
        <section className="v3-empty share-v3-access" aria-labelledby="share-access-title" role={failed ? "alert" : undefined}>
          <div className="v3-stage"><ShareAccessArt failed={failed} /></div>
          <h3 id="share-access-title">{failed ? t("分享内容暂时无法加载") : t("这份简历没有公开")}</h3>
          <p>{failed ? t("网络不稳定或服务暂时不可用，请稍后重新加载。") : t("分享者把它设成了仅自己可见。如果你是分享者本人，登录后就能查看。")}</p>
          <div className="v3-empty-actions">{failed
            ? <button className="v3-btn v3-btn-ghost" onClick={() => setLoadAttempt((attempt) => attempt + 1)}><Icon name="refresh" size={13} />{t("重新加载")}</button>
            : <a className="v3-btn v3-btn-ghost" href={authPath("login", `/share/${encodeURIComponent(token)}`)}>{t("登录")}</a>}</div>
        </section>
      </div>
    </ShareFrame>;
  }

  if (status === "unavailable" || !payload) {
    // 后端对私密、过期、已删除统一返回 404，无法确定原因时沿用不可用文案。
    return (
      <ShareFrame note={t("公开分享 · 链接不可用")}>
        <div className="share-v3-empty">
          <section className="v3-empty" aria-labelledby="share-unavailable-title">
            <div className="v3-stage has-dots"><BrokenLinkArt /></div>
            <h3 id="share-unavailable-title">{t("这条分享链接已失效")}</h3>
            <p>{t("链接可能已过期、被删除，或者分享者把它设成了仅自己可见。可以联系分享者重新发一个链接。")}</p>
          </section>
        </div>
      </ShareFrame>
    );
  }

  const wrapStyle: React.CSSProperties = zoomSupported
    ? ({ zoom: fit.scale } as React.CSSProperties)
    : {
        width: PAPER_WIDTH_PX * fit.scale,
        height: fit.height ?? undefined,
        overflow: "hidden",
      };
  const identity = payload.data.identity;
  const displayName = identity.name?.value?.trim() || payload.sharer.nickname;
  const contacts = identity.contacts.filter((contact) => contact.value?.trim()).slice(0, 4);
  return (
    <ShareFrame note={expiryNote(payload.expires_at)}>
      <div className="share-v3-layout">
        <div className="share-v3-paper-col">
          <section className="share-page-paper-scroll share-v3-paper-fit">
            <div
              ref={wrapRef}
              className="share-page-paper-wrap"
              style={wrapStyle}
            >
              <SharePaperInner
                html={documentHtml}
                innerRef={innerRef}
                scale={fit.scale}
                zoomSupported={zoomSupported}
              />
            </div>
          </section>
          <p className="share-v3-foot">
            <span>{pageCount} / {pageCount}{t(" 页 · 最后更新 ")}{shortDate(payload.updated_at)}</span>
          </p>
        </div>

        <aside className="share-v3-side" aria-label={t("分享者信息")}>
          <section className="share-v3-pcard share-v3-profile">
            <div className="v3-stage" />
            <span className="share-v3-avatar" aria-hidden="true">
              {payload.sharer.avatar_url
                ? <img src={payload.sharer.avatar_url} alt="" />
                : [...displayName][0]}
            </span>
            <h2 className="share-v3-name">{displayName}</h2>
            {/* 设计稿这一行是职位 · 年限 · 城市；简历没填 headline 时显示分享者昵称 */}
            <p className="share-v3-headline">
              {identity.headline?.value || t("由 {value0} 分享", { value0: payload.sharer.nickname })}
            </p>
            {contacts.length ? (
              <ul className="share-v3-contacts">
                {contacts.map((contact) => (
                  <li key={contact.node_id}>
                    <Icon name={CONTACT_ICON[contact.contact_kind] ?? "link"} size={14} />
                    <span>{contact.value}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="share-v3-actions">
              {payload.allow_download ? (
                <>
                  <button type="button" className="v3-btn v3-btn-dark" disabled={pdfPending} onClick={downloadPdf}>
                    {pdfPending ? t("正在生成…") : t("下载 PDF")}
                  </button>
                  <button type="button" className="share-v3-copy" aria-label={t("复制链接")} title={t("复制链接")} onClick={copyLink}>
                    <Icon name="link" size={14} />
                  </button>
                </>
              ) : (
                <button type="button" className="share-v3-copy-wide" onClick={copyLink}>
                  <span className="share-v3-copy" aria-hidden="true"><Icon name="link" size={14} /></span>{t("复制链接")}</button>
              )}
            </div>
            {pdfError ? <p className="share-v3-error" role="alert">{pdfError}</p> : null}
          </section>

          <section className="share-v3-pcard share-v3-promo">
            <div className="v3-stage"><PromoArt /></div>
            <h2>{t("这份简历由 LinkResume 制作")}</h2>
            <p>{t("AI 帮你写、帮你改，还能追踪每一次投递。")}</p>
            <a className="v3-link" href="/">{t("免费试试")}<Icon name="arrow" size={12} /></a>
          </section>
        </aside>
      </div>
      <MotionPresence>{toast ? <Toast title={toast} kind={toast === t("链接已复制") ? "success" : "error"} onDismiss={() => setToast(null)} /> : null}</MotionPresence>
    </ShareFrame>
  );
}
