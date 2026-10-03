import { t, useLocale, getLocale } from "@/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type DatasetRecord } from "../../../api/client";
import { getLocalThumbnail, THUMBNAIL_TEXT_LIMIT } from "../datasetThumbnails";

export function DocumentThumbnail({ dataset, fallback }: { dataset: DatasetRecord; fallback: ReactNode }) {
  useLocale();
  const host = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | undefined>(() => getLocalThumbnail(dataset));
  const [html, setHtml] = useState("");
  useEffect(() => {
    let cancelled = false;
    setText(getLocalThumbnail(dataset));
    if (dataset.upload_status !== "succeeded" || dataset.parse_status !== "succeeded") return;
    if (typeof IntersectionObserver === "undefined") return;
    const load = () => {
      void api.getDatasetContent(dataset.id).then((result) => {
        if (!cancelled) setText(result.markdown.slice(0, THUMBNAIL_TEXT_LIMIT));
      }).catch(() => { /* Keep the placeholder when content is unavailable. */ });
    };
    // Only fetch thumbnails near the viewport, rather than the entire library.
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: "160px" });
    if (host.current) observer.observe(host.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [dataset.id, dataset.content_revision, dataset.created_at, dataset.upload_status, dataset.parse_status]);

  useEffect(() => {
    let cancelled = false;
    if (text === undefined) {
      setHtml("");
      return;
    }
    void import("../datasetMarkdown").then(({ renderDatasetMarkdown }) => {
      if (cancelled) return;
      setHtml(renderDatasetMarkdown(text)
        .replace(/<a\b[^>]*>/g, "<span>").replace(/<\/a>/g, "</span>"));
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  return <div ref={host} className="dataset-thumbnail-host">
    {text === undefined ? fallback : <div className="dataset-paper-thumbnail">
      {dataset.file_format.toLowerCase() === "txt" && !dataset.content_updated_at
        ? <div className="dataset-paper-content is-plain">{text || t("空白文档")}</div>
        : <div className="dataset-paper-content" dangerouslySetInnerHTML={{ __html: html || t("<p>空白文档</p>") }} />}
    </div>}
  </div>;
}
