import { useEffect, useRef } from "react";

export function HeroDemo() {
  const frame = useRef<HTMLIFrameElement>(null);

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

  return (
    <div className="fl-hero-stage" aria-label="LinkResume 产品首页演示">
      <span className="fl-demo-label">互动演示 · 示例数据</span>
      <iframe
        ref={frame}
        className="fl-demo-frame"
        name="linkresume-landing-demo"
        title="LinkResume 产品互动演示 · 示例数据"
        src="/landing-demo.html"
        loading="lazy"
      />
    </div>
  );
}
