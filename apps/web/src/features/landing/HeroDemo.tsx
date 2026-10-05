import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale } from "@/i18n";
import { lt } from "./landingCopy";

/** 演示按真实设备视口渲染再等比缩放：桌面取 13 寸笔记本的 1440×900，平板与手机使用对应的原生宽度。 */
function viewportFor(width: number) {
  if (width >= 900) return { width: 1440, height: 900 };
  if (width >= 600) return { width: 1024, height: 720 };
  return { width: 390, height: 760 };
}

export function HeroDemo() {
  const locale = useLocale();
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(1160);

  useEffect(() => {
    const scroll = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== location.origin) return;
      if (event.data?.type !== "linkresume:landing-scroll" || !Number.isFinite(event.data.deltaY)) return;
      const limit = window.innerHeight * 3;
      window.scrollBy({ top: Math.max(-limit, Math.min(limit, event.data.deltaY)), behavior: "instant" });
    };
    window.addEventListener("message", scroll);
    return () => window.removeEventListener("message", scroll);
  }, []);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const update = () => { if (element.clientWidth) setBox(element.clientWidth); };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const viewport = viewportFor(box);
  const scale = Math.min(1, box / viewport.width);

  return (
    <div ref={stage} id="demo" className="fl-hero-stage" aria-label={lt("LinkResume 产品首页演示")} style={{ height: Math.round(viewport.height * scale) }}>
      <span className="fl-demo-label">{lt("互动演示 · 示例数据")}</span>
      <div className="fl-demo-viewport">
        <iframe
          key={locale}
          ref={frame}
          className="fl-demo-frame"
          name="linkresume-landing-demo"
          title={lt("LinkResume 产品互动演示 · 示例数据")}
          src={`/landing-demo.html?locale=${locale}`}
          loading="lazy"
          style={{ width: viewport.width, height: viewport.height, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}
