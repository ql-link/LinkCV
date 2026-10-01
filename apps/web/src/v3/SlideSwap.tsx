// 左右翻页的过渡：切到下一项时，旧内容向左滑出、新内容从右滑入（上一项反之），像系统相册 / App Store 截图那样。
// 用法：<SlideSwap itemKey={当前项 id} direction={1 | -1}>{当前项的内容}</SlideSwap>
// 旧内容在退场期间保留一份快照（不可交互、对读屏隐藏），动画结束后移除；
// 新内容从第一帧起就在正常文档流里，所以滚动容器、焦点和可访问名称都只对应当前项。
import { useEffect, useRef, useState, type ReactNode } from "react";

const SLIDE_MS = 420;

export function SlideSwap({
  itemKey,
  direction,
  children,
  className = "",
  distance = 56,
}: {
  itemKey: string;
  direction: 1 | -1;
  children: ReactNode;
  className?: string;
  /** 位移距离（px）；内容越大可以越远，但不宜超过容器宽度的 1/4 */
  distance?: number;
}) {
  const [currentKey, setCurrentKey] = useState(itemKey);
  const [leaving, setLeaving] = useState<{ key: string; node: ReactNode; direction: 1 | -1 } | null>(null);
  const [enterDirection, setEnterDirection] = useState<1 | -1 | 0>(0);
  // 记下上一次渲染的内容，切换时把它作为退场快照
  const lastChildren = useRef<ReactNode>(children);

  // 渲染阶段就切换，保证新内容第一帧就在位置上（不会先闪一帧旧内容）
  if (currentKey !== itemKey) {
    setLeaving({ key: currentKey, node: lastChildren.current, direction });
    setEnterDirection(direction);
    setCurrentKey(itemKey);
  }
  useEffect(() => { lastChildren.current = children; });

  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!leaving) return undefined;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setLeaving(null); setEnterDirection(0); }, SLIDE_MS);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [leaving]);

  return (
    <div className={`v3-slide-swap ${className}`} style={{ ["--slide-distance" as string]: `${distance}px` }}>
      {leaving && (
        <div
          key={`leave:${leaving.key}`}
          className={`v3-slide-item is-leaving ${leaving.direction === 1 ? "to-left" : "to-right"}`}
          aria-hidden="true"
          inert
        >
          {leaving.node}
        </div>
      )}
      <div
        key={`enter:${itemKey}`}
        className={`v3-slide-item${enterDirection ? ` is-entering ${enterDirection === 1 ? "from-right" : "from-left"}` : ""}`}
      >
        {children}
      </div>
    </div>
  );
}
