import { useEffect, useRef, useState } from "react";
import { renderHeroBackdrop } from "./renderHeroBackdrop";

export function HeroBackdrop({ reduced }: { reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const target = canvas.current;
    if (!target) return;
    const dispose = renderHeroBackdrop(target, reduced, () => setReady(true), () => setReady(false));
    return () => dispose?.();
  }, [reduced]);

  return <div className="fl-hero-atmosphere" aria-hidden="true" data-renderer={ready ? reduced ? "static" : "procedural" : "fallback"}>
    <canvas ref={canvas} className="fl-hero-canvas" />
  </div>;
}
