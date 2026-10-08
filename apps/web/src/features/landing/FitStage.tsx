import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** 以设计稿尺寸绘制静态产品画面，容器变窄时整体等比缩小，变宽时居中保持原尺寸。 */
export function FitStage({ width, height, className, stageClassName, label, children }: { width: number; height: number; className?: string; stageClassName?: string; label?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const update = () => { const next = element.clientWidth ? Math.min(1, element.clientWidth / width) : 1; setScale(value => Math.abs(value - next) < 0.001 ? value : next); };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  return <div ref={box} className={`fl-fit${className ? ` ${className}` : ""}`} style={{ height: height * scale }} role={label ? "img" : undefined} aria-label={label}>
    <div className={`fl-fit-stage${stageClassName ? ` ${stageClassName}` : ""}`} aria-hidden={label ? true : undefined} style={{ width, height, transform: `translateX(-50%) scale(${scale})` }}>{children}</div>
  </div>;
}
