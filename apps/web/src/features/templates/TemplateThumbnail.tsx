import { useEffect, useRef, useState } from "react";
import type { ResumeTemplate } from "../../api/client";
import { ResumePreview } from "../preview/ResumePreview";

export function TemplateThumbnail({ template }: {
  template: Pick<ResumeTemplate, "data" | "style" | "layout_plan">;
}) {
  const thumbnailRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const thumbnail = thumbnailRef.current;
    if (!thumbnail || typeof IntersectionObserver === "undefined") return;
    // Observe the browser viewport so this also works when a short window makes
    // the whole page scroll instead of the grid. Nested scroll clipping still applies.
    // The outer aspect-ratio reserves the same space whether a preview is mounted or not.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setNearViewport(entry.isIntersecting);
    }, { rootMargin: "320px 0px" });
    observer.observe(thumbnail);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={thumbnailRef} className="tpl-card-thumb">
      {nearViewport && <ResumePreview data={template.data} style={template.style} layoutPlan={template.layout_plan} />}
    </div>
  );
}
