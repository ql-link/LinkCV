import type { ReactNode } from "react";
import { MiniResume } from "./art";
import { Icon } from "./Icon";
import "./v3.css";
import "./states.css";

// 插图坐标照 Figma：Figma rotation 逆时针且绕左上角，CSS 里取反并设 transform-origin: 0 0。

// 10.1 页面加载中 / 10.2 页面加载失败（Figma 159:363 / 159:465，以 02 我的简历为例）。
// 供各工作区页面在首次加载、整页请求失败时复用；只渲染内容卡里的东西，外壳由 V3Shell 提供。

export type PageHeaderSpec = {
  eyebrow: string;
  title: string;
  sub?: string;
  /** 页头右侧按钮（加载中与失败时仍保留，和真实页面一致，避免加载完跳动） */
  actions?: ReactNode;
};

function StateHeader({ header }: { header: PageHeaderSpec }) {
  return (
    <header className="v3-state-head">
      <div>
        <p className="v3-page-eyebrow">{header.eyebrow}</p>
        <h1 className="v3-page-title">{header.title}</h1>
        {header.sub ? <p className="v3-page-sub">{header.sub}</p> : null}
      </div>
      {header.actions ? <div className="v3-state-head-actions">{header.actions}</div> : null}
    </header>
  );
}

/**
 * 10.1 页面加载中：保留页头，筛选胶囊 + 分隔线 + 4×2 骨架卡片（200×264，与真实简历卡同尺寸）。
 * 不传 header 时只显示骨架。label 只给读屏器。
 */
export function PageLoadingV3({
  label = "正在加载…",
  header,
  cards = 8,
}: {
  label?: string;
  header?: PageHeaderSpec;
  cards?: number;
}) {
  return (
    <div className="v3-page v3-state" role="status" aria-busy="true" aria-live="polite" aria-label={label}>
      {header ? <StateHeader header={header} /> : null}
      {/* 筛选胶囊骨架：设计稿 y=168，四个 40/53/53/40 宽 */}
      <div className="v3-state-chips" aria-hidden="true">
        {[40, 53, 53, 40].map((width, index) => <span key={index} style={{ width }} />)}
      </div>
      <div className="v3-state-rule" aria-hidden="true" />
      <div className="v3-state-grid" aria-hidden="true">
        {Array.from({ length: cards }, (_, index) => (
          <div key={index} className="v3-state-skel">
            <span className="v3-state-skel-cover" />
            <span className="v3-state-skel-line" style={{ width: "70%", height: 10 }} />
            <span className="v3-state-skel-line" style={{ width: "40%", height: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 错误卡插图（舞台 464×150）：两张淡掉的简历夹着一张，中间一个断开的云角标 */
export function PageErrorArt() {
  return (
    <span aria-hidden="true" className="v3-state-art">
      <MiniResume x={128} y={26} w={68} h={92} accent="var(--v3-fnt2)" rotate={8} style={{ opacity: 0.5, boxShadow: "none", transformOrigin: "0 0" }} />
      <MiniResume x={268} y={26} w={68} h={92} accent="var(--v3-fnt2)" rotate={-8} style={{ opacity: 0.5, boxShadow: "none", transformOrigin: "0 0" }} />
      <MiniResume x={194} y={20} w={76} h={104} accent="var(--v3-fnt2)" style={{ opacity: 0.8, boxShadow: "none" }} />
      <span className="v3-state-cloud">
        {/* 取自 Figma 导出的原始路径，viewBox 对齐 40×40 图标框 */}
        <svg width="40" height="40" viewBox="24 14 40 40" fill="none">
          <path d="M30.25 39a9.4 9.4 0 0 1 1.875-16.876 11.9 11.9 0 0 1 21.25 2.5 7.2 7.2 0 0 1 .625 14.375" stroke="#96968f" strokeWidth="1.875" strokeLinecap="round" />
          <path d="M41.5 35.25l5 5M46.5 35.25l-5 5" stroke="#d64545" strokeWidth="1.875" strokeLinecap="round" />
        </svg>
      </span>
    </span>
  );
}

/**
 * 10.2 页面加载失败：保留页头与分隔线，内容区居中一张错误卡（480 宽、舞台 150 高），
 * 衬线标题 + 说明（告诉用户数据没丢）+ 描边「重新加载」按钮。不向用户展示错误代码。
 */
export function PageErrorV3({
  header,
  title,
  description = "网络不稳定或服务暂时不可用，你的数据都还在，刷新一下试试。",
  retryLabel = "重新加载",
  onRetry,
  art,
}: {
  header?: PageHeaderSpec;
  title: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
  art?: ReactNode;
}) {
  return (
    <div className="v3-page v3-state">
      {header ? <StateHeader header={header} /> : null}
      {header ? <div className="v3-state-rule is-error" aria-hidden="true" /> : null}
      <ErrorCardV3 title={title} description={description} retryLabel={retryLabel} onRetry={onRetry} art={art} />
    </div>
  );
}

/** 单独的错误卡（不带页头），模块内局部失败也可以直接用 */
export function ErrorCardV3({
  title,
  description,
  retryLabel = "重新加载",
  onRetry,
  art,
}: {
  title: string;
  description: string;
  retryLabel?: string;
  onRetry?: () => void;
  art?: ReactNode;
}) {
  return (
    <section className="v3-empty is-error v3-state-error" role="alert" aria-labelledby="v3-state-error-title">
      <div className="v3-stage has-dots">{art ?? <PageErrorArt />}</div>
      <h3 id="v3-state-error-title">{title}</h3>
      <p>{description}</p>
      {onRetry ? (
        <div className="v3-empty-actions">
          <button type="button" className="v3-btn v3-btn-ghost is-lg v3-state-retry" onClick={onRetry}>
            <Icon name="refresh" size={13} />
            {retryLabel}
          </button>
        </div>
      ) : null}
    </section>
  );
}
