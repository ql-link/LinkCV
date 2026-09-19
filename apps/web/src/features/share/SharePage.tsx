import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, Link2Off } from "lucide-react";
import { Brand, Button, PageLoading } from "@/components/ui";
import { api, type PublicSharePayload } from "../../api/client";
import { resumeDocumentTitle } from "../../api/resumeContract";
import {
  downloadPdfBlob,
  resumePdfExportErrorMessage,
  resumePdfFilename,
} from "../preview/pdfExport";
import "../preview/print/resume-print.css";
import { renderResumePrintDocument } from "../preview/print/resumePrintDocument";

function ShareBrand() {
  return <Brand className="share-brand" label="linkresume" name="linkresume" />;
}

type ShareStatus = "loading" | "ready" | "unavailable";

// 210mm A4 纸宽约 794px；除以略大的基准让移动端留出边距
const PAPER_WIDTH_PX = 820;

function useMobilePaperZoom() {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const update = () => {
      setZoom(Math.min(1, window.innerWidth / PAPER_WIDTH_PX));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return zoom;
}

export function SharePage({ token }: { token: string }) {
  const [payload, setPayload] = useState<PublicSharePayload | null>(null);
  const [status, setStatus] = useState<ShareStatus>("loading");
  const [pdfPending, setPdfPending] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfAbortRef = useRef<AbortController | null>(null);
  const paperZoom = useMobilePaperZoom();

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
      pdfAbortRef.current?.abort();
    };
  }, [token]);

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

  const documentHtml = useMemo(
    () => payload
      ? renderResumePrintDocument({
        title: resumeDocumentTitle(payload.data) || "LinkResume Resume",
        data: payload.data,
        style: {
          ...payload.style,
          portable: {
            ...payload.style.portable,
            smart_one_page: true,
          },
        },
        layout_plan: payload.layout_plan,
        assets: payload.assets,
      }, { className: "share-page-paper", ariaLabel: "分享简历内容" })
      : "",
    [payload],
  );

  if (status === "loading") {
    return (
      <div className="share-page-loading" data-ui-theme="light">
        <PageLoading label="正在加载分享内容…" scope="page" />
      </div>
    );
  }

  if (status === "unavailable" || !payload) {
    return (
      <main className="share-unavailable" data-ui-theme="light">
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

  return (
    <main className="share-page" data-ui-theme="light">
      <header className="share-page-header">
        <div className="share-page-header-identity">
          <ShareBrand />
          <span className="share-page-header-divider" aria-hidden="true" />
          <span className="share-page-header-note">由 {payload.sharer.nickname} 分享</span>
        </div>
        <span className="share-page-header-actions">
          <a className="share-page-home-link" href="/">
            <span>访问 LinkResume</span>
            <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
          </a>
          {pdfError ? <span className="share-page-download-error" role="alert">{pdfError}</span> : null}
          <Button
            variant="secondary"
            size="sm"
            icon={<Download size={14} />}
            disabled={pdfPending}
            onClick={downloadPdf}
          >
            {pdfPending ? "正在生成…" : "下载 PDF"}
          </Button>
        </span>
      </header>
      <section className="share-page-paper-scroll">
        <div
          className="share-page-paper-wrap"
          style={{ zoom: paperZoom } as React.CSSProperties}
          dangerouslySetInnerHTML={{ __html: documentHtml }}
        />
      </section>
    </main>
  );
}
