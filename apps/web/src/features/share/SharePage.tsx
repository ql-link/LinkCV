import { useEffect, useMemo, useState } from "react";
import { Link2Off } from "lucide-react";
import { Brand } from "@/components/ui";
import { api, type PublicSharePayload } from "../../api/client";
import {
  resumeDocumentToMarkdown,
  styleToEditorSettings,
} from "../../api/resumeContract";
import { renderResumeMarkdown } from "../../parser/resumeMarkdown";

function ShareBrand() {
  return <Brand className="share-brand" label="linkresume" name="linkresume" />;
}

type ShareStatus = "loading" | "ready" | "unavailable";

// 210mm A4 纸宽约 794px；除以略大的基准让移动端留出边距
const PAPER_WIDTH_PX = 820;

function paperStyle(payload: PublicSharePayload) {
  const settings = styleToEditorSettings(payload.style);
  return {
    "--resume-font-family": settings.fontFamily,
    "--resume-font-size": `${settings.fontSize}pt`,
    "--resume-line-height": settings.lineHeight,
    "--resume-page-margin-x": `${settings.pageMargin}mm`,
    "--resume-page-margin-y": `${settings.verticalPageMargin}mm`,
  } as React.CSSProperties;
}

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
    };
  }, [token]);

  const markdown = useMemo(
    () => (payload ? resumeDocumentToMarkdown(payload.data) : ""),
    [payload],
  );
  const html = useMemo(() => renderResumeMarkdown(markdown), [markdown]);

  if (status === "loading") {
    return <div className="app-loading">正在加载分享内容...</div>;
  }

  if (status === "unavailable" || !payload) {
    return (
      <main className="share-unavailable">
        <ShareBrand />
        <section className="share-unavailable-card">
          <span className="share-unavailable-icon" aria-hidden="true">
            <Link2Off size={24} strokeWidth={1.8} />
          </span>
          <h1>分享链接已失效</h1>
          <p>链接不存在、已过期，或分享者已将其关闭。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="share-page">
      <header className="share-page-header">
        <ShareBrand />
        <span className="share-page-header-note">简历分享</span>
        <span className="share-owner">
          {payload.sharer.avatar_url && (
            <img
              className="share-owner-avatar"
              src={payload.sharer.avatar_url}
              alt=""
            />
          )}
          <span>{payload.sharer.nickname} 分享的简历</span>
        </span>
      </header>
      <section className="share-page-paper-scroll">
        <article
          className="resume-paper smart-one-page share-page-paper"
          style={{
            ...paperStyle(payload),
            zoom: paperZoom,
          }}
          aria-label="分享简历内容"
        >
          <div
            className="resume-content share-page-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </article>
      </section>
      <footer className="share-page-footer">由 linkresume 生成</footer>
    </main>
  );
}
