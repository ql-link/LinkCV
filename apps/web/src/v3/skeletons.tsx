import { t, useLocale } from "@/i18n";
// 骨架屏：页面等数据（或等页面代码加载）时，先按真实页面的版式画出灰色占位块。
// 两个用途共用同一套版式，避免「转圈 → 骨架 → 内容」三段切换造成的闪烁：
//   1. 路由级：页面代码还在下载时，App.tsx 用 <RouteSkeleton section> 画整页（页头 + 主体）。
//   2. 页面级：页面已渲染出真实页头、数据还在请求时，只用主体部分的 SkeletonGrid / SkeletonRows 等。
// 占位块出现前有 150ms 延迟（快的请求直接看到内容，不闪一下骨架）；内容替换骨架时用 .v3-reveal 淡入。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { V3Section } from "./Shell";
import "./skeletons.css";

export function Sk({ w, h = 12, r, style, className = "" }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties; className?: string }) {
  useLocale();
  return <span aria-hidden="true" className={`v3-sk ${className}`} style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

function SkeletonRoot({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  useLocale();
  return (
    <div className={`v3-skeleton ${className}`} role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

// 页头：小字 + 衬线大标题 + 副标题，右侧按钮
export function SkeletonHead({ actions = 1, sub = true }: { actions?: number; sub?: boolean }) {
  useLocale();
  return (
    <div className="v3-sk-head">
      <div>
        <Sk w={72} h={10} />
        <Sk w={180} h={30} r={6} style={{ marginTop: 12 }} />
        {sub && <Sk w={260} h={12} style={{ marginTop: 12 }} />}
      </div>
      <div className="v3-sk-head-actions">
        {Array.from({ length: actions }, (_, index) => <Sk key={index} w={index === actions - 1 ? 104 : 88} h={32} r={8} />)}
      </div>
    </div>
  );
}

// 卡片网格（简历、模板）：A4 比例纸面 + 两行文字
export function SkeletonGrid({ count = 8, label = "正在加载…", className = "" }: { count?: number; label?: string; className?: string }) {
  useLocale();
  return (
    <SkeletonRoot label={label} className={`v3-sk-grid ${className}`}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="v3-sk-card">
          {/* 高度交给 aspect-ratio（A4），不能用 Sk 默认的 12px 高度 */}
          <Sk className="v3-sk-paper" h="auto" r={6} />
          <Sk w="70%" h={13} style={{ marginTop: 15.5 }} />
          <Sk w="45%" h={10} style={{ marginTop: 9 }} />
        </div>
      ))}
    </SkeletonRoot>
  );
}

// 列表 / 表格：可选表头 + 若干行
export function SkeletonRows({ rows = 6, label = "正在加载…", header = true, className = "" }: { rows?: number; label?: string; header?: boolean; className?: string }) {
  useLocale();
  return (
    <SkeletonRoot label={label} className={`v3-sk-rows ${className}`}>
      {header && <div className="v3-sk-row is-head"><Sk w={64} h={10} /><Sk w={48} h={10} /><Sk w={40} h={10} /><Sk w={56} h={10} /></div>}
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="v3-sk-row">
          <Sk w={32} h={32} r={8} />
          <div className="v3-sk-row-main"><Sk w={`${58 - (index % 3) * 9}%`} h={13} /><Sk w="32%" h={10} style={{ marginTop: 7 }} /></div>
          <Sk w={72} h={11} />
          <Sk w={56} h={11} />
        </div>
      ))}
    </SkeletonRoot>
  );
}

// 若干张收纳卡片（账号、报告、详情页）
export function SkeletonCards({ cards = [120, 180, 140], label = "正在加载…", className = "" }: { cards?: number[]; label?: string; className?: string }) {
  useLocale();
  return (
    <SkeletonRoot label={label} className={`v3-sk-cards ${className}`}>
      {cards.map((height, index) => (
        <div key={index} className="v3-sk-box" style={{ height }}>
          <Sk w={96} h={12} />
          <Sk w="80%" h={11} style={{ marginTop: 16 }} />
          <Sk w="62%" h={11} style={{ marginTop: 10 }} />
        </div>
      ))}
    </SkeletonRoot>
  );
}

// 看板：列宽随容器变化，预留足够的占位列供超宽屏显示。
export function SkeletonBoard({ label = "正在加载求职数据…" }: { label?: string }) {
  useLocale();
  return (
    <SkeletonRoot label={label} className="v3-sk-board">
      {[3, 2, 2, 1, 2, 3, 2, 2, 1, 2].map((count, column) => (
        <div key={column} className="v3-sk-column">
          <Sk w={64} h={11} style={{ margin: "14px 6px 16px" }} />
          {Array.from({ length: count }, (_, index) => <Sk key={index} className="v3-sk-board-card" r={8} />)}
        </div>
      ))}
    </SkeletonRoot>
  );
}

// 日历：7 列 × 若干行的格子
export function SkeletonCalendar({ label = "正在加载日程…" }: { label?: string }) {
  useLocale();
  return (
    <SkeletonRoot label={label} className="v3-sk-calendar">
      <div className="v3-sk-calendar-bar"><Sk w={112} h={30} r={8} /><Sk w={120} h={30} r={8} /></div>
      <div className="v3-sk-calendar-grid">
        {Array.from({ length: 35 }, (_, index) => (
          <div key={index} className="v3-sk-calendar-cell">
            <Sk w={16} h={10} />
            {index % 5 === 1 && <Sk w="80%" h={14} r={4} style={{ marginTop: 10 }} />}
          </div>
        ))}
      </div>
    </SkeletonRoot>
  );
}

// 路由级整页骨架：页面代码下载期间显示，版式与各页面加载数据时的骨架一致
export function RouteSkeleton({ section }: { section: V3Section }) {
  useLocale();
  // 首页是居中的对话输入区，不套页头
  if (section === "home") {
    return (
      <div className="v3-sk-page is-home" role="status" aria-busy="true" aria-label={t("正在加载页面…")}>
        <Sk w={260} h={30} r={6} />
        <Sk w={340} h={12} style={{ marginTop: 14 }} />
        <div className="v3-sk-home-cards">{[0, 1, 2].map((index) => <Sk key={index} h={150} r={12} />)}</div>
        <Sk className="v3-sk-composer" r={16} />
      </div>
    );
  }
  const body = section === "resumes" || section === "templates"
    ? <><div className="v3-sk-toolbar"><Sk w={96} h={14} /><Sk w={220} h={30} r={8} /></div><SkeletonGrid /></>
    : section === "jobs"
      ? <><div className="v3-sk-stats">{[0, 1, 2, 3].map((index) => <Sk key={index} w={120} h={40} r={8} />)}</div><SkeletonBoard /></>
      : section === "schedule"
        ? <SkeletonCalendar />
        : section === "datasets"
          ? <><div className="v3-sk-folders">{[0, 1, 2].map((index) => <Sk key={index} h={172} r={12} />)}</div><SkeletonRows rows={4} header={false} /></>
          : section === "account"
            ? <SkeletonCards cards={[92, 168, 132]} />
            : section === "mock"
              ? <SkeletonCards cards={[196, 150, 120]} />
              : <SkeletonCards />;
  return (
    <div className={`v3-sk-page is-${section}`} role="status" aria-busy="true" aria-label={t("正在加载页面…")}>
      <SkeletonHead actions={section === "jobs" || section === "datasets" ? 2 : 1} />
      {body}
    </div>
  );
}

/*
 * 骨架 → 真实内容的交接：骨架淡出、内容淡入同时进行（交叉淡化），而不是骨架先消失、内容再从透明出现。
 * 关键是「真实内容从第一帧起就在它最终的位置」：交接期间内容照常排版、不加任何包裹层，
 * 骨架作为一个绝对定位的「残影」叠在它原来的位置上淡出，所以文字和卡片不会有任何位移。
 * 整块区域只让残影淡出（内容在下方直接呈现）；行内文字外面包一层普通 inline，内容同时淡入。
 * - 首次渲染时数据已经就绪（缓存命中）或 150ms 内返回：直接显示内容，不做动画。
 * - inline 用于标题、数字、副标题这类行内文字；默认用于网格、列表等整块区域。
 */
export function Reveal({
  loading,
  placeholder,
  children,
  inline = false,
  className = "",
}: {
  loading: boolean;
  placeholder: ReactNode;
  children: ReactNode;
  inline?: boolean;
  className?: string;
}) {
  useLocale();
  const [loadingSince, setLoadingSince] = useState<number | null>(() => (loading ? Date.now() : null));
  const [fadeKey, setFadeKey] = useState(0);
  const [previousLoading, setPreviousLoading] = useState(loading);
  const [ghost, setGhost] = useState<GhostRect | null>(null);
  const slotRef = useRef<HTMLElement | null>(null);
  const lastRect = useRef<GhostRect | null>(null);

  // 在渲染阶段就判定「刚从加载变为就绪」，第一帧就是交叉淡化，不会先闪一帧内容
  if (previousLoading !== loading) {
    setPreviousLoading(loading);
    if (loading) {
      setLoadingSince(Date.now());
    } else {
      if (loadingSince !== null && Date.now() - loadingSince > 150) {
        setFadeKey((key) => key + 1);
        setGhost(lastRect.current);
      }
      setLoadingSince(null);
    }
  }

  // 加载期间记下骨架相对于父元素的位置，交接时残影就叠在这里
  useLayoutEffect(() => {
    if (!loading || inline) return;
    const node = slotRef.current;
    const parent = node?.parentElement;
    if (!node || !parent) return;
    const box = node.getBoundingClientRect();
    lastRect.current = { top: box.top, left: box.left, width: box.width, height: box.height };
  });

  // 残影挂载后，把记下的视口坐标换算成相对它 offsetParent 的坐标（不改动任何父元素的定位方式）
  const ghostRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const node = ghostRef.current;
    if (!node || !ghost) return;
    const parent = node.offsetParent as HTMLElement | null;
    const origin = parent?.getBoundingClientRect() ?? { top: 0, left: 0 };
    node.style.top = `${ghost.top - origin.top + (parent?.scrollTop ?? 0)}px`;
    node.style.left = `${ghost.left - origin.left + (parent?.scrollLeft ?? 0)}px`;
  }, [ghost]);

  const [doneKey, setDoneKey] = useState(0);
  const fading = fadeKey !== doneKey;
  useEffect(() => {
    if (!fading) return undefined;
    const timer = window.setTimeout(() => { setDoneKey(fadeKey); setGhost(null); }, REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [fadeKey, fading]);

  if (inline) {
    if (loading) return <span className={`v3-reveal-inline ${className}`}>{placeholder}</span>;
    // 行内：外层只是 position: relative 的普通 inline，不改变行高和基线；残影叠在文字起点处。
    // 淡化前后保持同一套节点结构，结束时只移除残影，文字节点不重新挂载（否则会再闪一次）
    return (
      <span className={`v3-reveal-inline ${className}`}>
        <span className={fading ? "v3-reveal-in" : undefined}>{children}</span>
        {fading && <span className="v3-reveal-ghost is-inline" aria-hidden="true">{placeholder}</span>}
      </span>
    );
  }
  if (loading) return <div ref={(node) => { slotRef.current = node; }} className={`v3-reveal-slot ${className}`}>{placeholder}</div>;
  // 淡化前后保持同一套子节点结构（内容永远是第 1 个子节点），结束时只移除残影，内容不重新挂载
  return (
    <>
      {children}
      {fading && ghost && (
        <div ref={ghostRef} className={`v3-reveal-ghost ${className}`} aria-hidden="true" style={{ width: ghost.width, height: ghost.height }}>
          {placeholder}
        </div>
      )}
    </>
  );
}

type GhostRect = { top: number; left: number; width: number; height: number };

const REVEAL_MS = 280;
