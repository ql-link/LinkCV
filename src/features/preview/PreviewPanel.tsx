import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { renderResumeMarkdown } from "../../parser/resumeMarkdown";
import { useResumeStore } from "../../store/resumeStore";
import { PreviewToolbar } from "./PreviewToolbar";
import { SourceModal } from "./SourceModal";

type PageFragment = {
  html: string;
};

function serializeAttributes(element: Element, excludedNames: string[] = []) {
  return Array.from(element.attributes)
    .filter((attribute) => !excludedNames.includes(attribute.name))
    .map((attribute) => `${attribute.name}="${attribute.value.replace(/"/g, "&quot;")}"`)
    .join(" ");
}

function buildPageFragments(children: Element[]): PageFragment[] {
  return children.flatMap((child) => {
    const tagName = child.tagName.toLowerCase();

    if (tagName !== "ol" && tagName !== "ul") {
      return [{ html: child.outerHTML }];
    }

    const items = Array.from(child.children).filter(
      (item) => item.tagName.toLowerCase() === "li",
    );
    const attributes = serializeAttributes(child, ["start"]);
    const attributeText = attributes ? ` ${attributes}` : "";
    const start = Number(child.getAttribute("start") ?? "1");

    return items.map((item, index) => {
      const startText = tagName === "ol" ? ` start="${start + index}"` : "";
      return {
        html: `<${tagName}${attributeText}${startText}>${item.outerHTML}</${tagName}>`,
      };
    });
  });
}

export function PreviewPanel() {
  const markdown = useResumeStore((state) => state.markdown);
  const settings = useResumeStore((state) => state.settings);
  const previewScale = useResumeStore((state) => state.previewScale);
  const setPreviewScale = useResumeStore((state) => state.setPreviewScale);
  const debouncedMarkdown = useDebouncedValue(markdown, 80);
  const html = useMemo(() => renderResumeMarkdown(debouncedMarkdown), [debouncedMarkdown]);
  const [pages, setPages] = useState<string[]>([html]);
  const pagesRootRef = useRef<HTMLDivElement | null>(null);
  const sourceMeasureRef = useRef<HTMLDivElement | null>(null);
  const pageMeasureRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const zoomPercent = Math.round(previewScale * 100);

  const resumeStyle = {
    "--resume-font-family": settings.fontFamily,
    "--resume-font-size": `${settings.fontSize}pt`,
    "--resume-line-height": settings.lineHeight,
    "--resume-page-margin-x": `${settings.pageMargin}mm`,
    "--resume-page-margin-y": `${settings.verticalPageMargin}mm`,
  } as React.CSSProperties;

  useLayoutEffect(() => {
    if (settings.smartOnePage) {
      setPages([html]);
      return;
    }

    const source = sourceMeasureRef.current;
    const pageMeasure = pageMeasureRef.current;
    if (!source || !pageMeasure) {
      setPages([html]);
      return;
    }

    const paginate = () => {
      const fragments = buildPageFragments(Array.from(source.children));
      const nextPages: string[] = [];
      let currentPage: string[] = [];

      pageMeasure.innerHTML = "";

      fragments.forEach((fragment) => {
        pageMeasure.insertAdjacentHTML("beforeend", fragment.html);

        if (pageMeasure.scrollHeight > pageMeasure.clientHeight + 1 && currentPage.length > 0) {
          nextPages.push(currentPage.join(""));
          currentPage = [fragment.html];
          pageMeasure.innerHTML = "";
          pageMeasure.insertAdjacentHTML("beforeend", fragment.html);
          return;
        }

        currentPage.push(fragment.html);
      });

      if (currentPage.length > 0) nextPages.push(currentPage.join(""));
      setPages(nextPages.length > 0 ? nextPages : [""]);
    };

    paginate();

    const images = source.querySelectorAll("img");
    images.forEach((image) => {
      image.addEventListener("load", paginate);
      image.addEventListener("error", paginate);
    });

    return () => {
      images.forEach((image) => {
        image.removeEventListener("load", paginate);
        image.removeEventListener("error", paginate);
      });
    };
  }, [
    html,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.pageMargin,
    settings.smartOnePage,
    settings.verticalPageMargin,
  ]);

  useEffect(() => {
    const images = pagesRootRef.current?.querySelectorAll<HTMLImageElement>("img[data-local-asset]");
    if (!images) return;

    const cleanups: Array<() => void> = [];

    images.forEach((image) => {
      const showImage = () => image.classList.remove("asset-error");
      const hideBrokenImage = () => image.classList.add("asset-error");

      image.addEventListener("load", showImage);
      image.addEventListener("error", hideBrokenImage);
      if (image.complete && image.naturalWidth === 0) hideBrokenImage();

      cleanups.push(() => {
        image.removeEventListener("load", showImage);
        image.removeEventListener("error", hideBrokenImage);
      });
    });

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [pages]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const nextScale = Math.min(1.6, Math.max(0.5, previewScale + direction * 0.08));
      setPreviewScale(Number(nextScale.toFixed(2)));
    };

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [previewScale, setPreviewScale]);

  return (
    <div className="preview-panel">
      <PreviewToolbar />
      <div
        ref={stageRef}
        className="paper-stage"
        style={{ "--preview-scale": previewScale } as React.CSSProperties}
      >
        <div className="zoom-indicator">{zoomPercent}%</div>
        <div
          ref={pagesRootRef}
          className={settings.smartOnePage ? "paper-zoom-frame single-page-mode" : "paper-zoom-frame"}
        >
          {pages.map((pageHtml, index) => (
            <div
              className={settings.smartOnePage ? "resume-page-frame single-page-frame" : "resume-page-frame"}
              key={`${index}-${pages.length}`}
            >
              <article
                className={`resume-paper theme-${settings.theme}${
                  settings.smartOnePage ? " smart-one-page" : ""
                }`}
                style={resumeStyle}
              >
                <div className="resume-content" dangerouslySetInnerHTML={{ __html: pageHtml }} />
                {!settings.smartOnePage && <div className="page-number">第 {index + 1} 页</div>}
              </article>
            </div>
          ))}
        </div>
        <div className="page-break-hint">
          {settings.smartOnePage
            ? "智能一页已开启：页面高度随内容增长，导出为单页"
            : "固定 A4 页面边界，超出内容自动进入下一页"}
        </div>
      </div>
      <div className="pagination-measure" aria-hidden="true">
        <article className={`resume-paper theme-${settings.theme}`} style={resumeStyle}>
          <div ref={sourceMeasureRef} className="resume-content" dangerouslySetInnerHTML={{ __html: html }} />
        </article>
        <article className={`resume-paper theme-${settings.theme}`} style={resumeStyle}>
          <div ref={pageMeasureRef} className="resume-content" />
        </article>
      </div>
      <SourceModal html={html} />
    </div>
  );
}
