import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useLocale } from "@/i18n";
import { lt } from "./landingCopy";

/**
 * Hero 产品演示：真实产品界面在 1440×900 视口下的静态截图（`scripts/capture-landing-demo.mjs` 生成），
 * 任何宽度下都整体等比缩小。只有侧栏可点击：切换页面或查看对话记录；其余区域不响应。
 * 侧栏由“全部未选中 / 全部已选中”两张图叠加，选中项通过裁剪区域滑动，与产品的选中滑块一致。
 */
type Row = { key: string; x: number; y: number; width: number; height: number };
type Layout = { viewport: { width: number; height: number }; sidebarWidth: number; create: Omit<Row, "key">; nav: Row[]; sessions: (Row & { label: string })[] };

const shots = import.meta.glob<string>("./demo-shots/*/*.webp", { eager: true, query: "?url", import: "default" });
const layouts = import.meta.glob<Layout>("./demo-shots/*/layout.json", { eager: true, import: "default" });
// 截图里白色内容卡片的圆角与它到窗口右边缘的间距；外框圆角取两者之和再随缩放变化，
// 保持与卡片同心，窄屏上卡片的右侧圆角才不会被外框圆角吞掉。
const cardRadius = 16;
const cardGap = 12;
const navLabels: Record<string, string> = { home: "首页", resumes: "我的简历", templates: "简历模板", jobs: "岗位看板", schedule: "面试日程", mock: "模拟面试", datasets: "资料库" };

function clipTo(row: Omit<Row, "key">, layout: Layout): CSSProperties {
  const right = layout.sidebarWidth - row.x - row.width;
  const bottom = layout.viewport.height - row.y - row.height;
  return { clipPath: `inset(${row.y}px ${right}px ${bottom}px ${row.x}px round 8px)` };
}

function prefetch(url: string) {
  const image = new Image();
  image.src = url;
}

export function HeroDemo() {
  const locale = useLocale();
  const folder = locale === "en-US" ? "en-US" : "zh-CN";
  const layout = layouts[`./demo-shots/${folder}/layout.json`];
  const shot = (key: string) => shots[`./demo-shots/${folder}/${key}.webp`];
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(1160);
  const [view, setView] = useState({ current: "home", previous: "home" });
  const [loaded, setLoaded] = useState(true);

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

  const { width, height } = layout.viewport;
  const scale = Math.min(1, box / width);
  const chat = layout.sessions.find(row => row.key === view.current);
  const navRow = layout.nav.find(row => row.key === (chat ? "home" : view.current)) ?? layout.nav[0];
  const show = (key: string) => {
    if (key === view.current) return;
    setLoaded(false);
    setView({ current: key, previous: view.current });
  };
  const pageLabel = chat ? chat.label : lt(navLabels[view.current]);
  const hotspot = (row: Omit<Row, "key">, key: string, label: string, selectable = true) => <button
    key={`${key}-${row.y}`}
    type="button"
    className="fl-demo-hotspot"
    style={{ left: row.x, top: row.y, width: row.width, height: row.height }}
    aria-label={label}
    aria-current={selectable && key === view.current ? "page" : undefined}
    onPointerEnter={() => prefetch(shot(key))}
    onFocus={() => prefetch(shot(key))}
    onClick={() => show(key)}
  />;

  return (
    <div ref={stage} id="demo" className="fl-hero-stage" aria-label={lt("DrawOffer 产品首页演示")} style={{ height: Math.round(height * scale) }}>
      <span className="fl-demo-label">{lt("互动演示 · 示例数据")}</span>
      <div className="fl-demo-viewport" style={{ borderRadius: (cardRadius + cardGap) * scale }}>
        <div className="fl-demo-window" style={{ width, height, transform: `scale(${scale})` }}>
          <img className="fl-demo-sidebar" src={shot("sidebar")} width={layout.sidebarWidth} height={height} alt="" />
          <img className="fl-demo-sidebar fl-demo-selected" src={shot("sidebar-active")} width={layout.sidebarWidth} height={height} alt="" style={clipTo(navRow, layout)} />
          <img className="fl-demo-sidebar fl-demo-selected" src={shot("sidebar-active")} width={layout.sidebarWidth} height={height} alt="" data-visible={Boolean(chat)} style={clipTo(chat ?? layout.sessions[0], layout)} />
          {view.previous !== view.current && <img className="fl-demo-page" src={shot(view.previous)} width={width - layout.sidebarWidth} height={height} alt="" />}
          <img key={`${folder}-${view.current}`} className="fl-demo-page" data-loaded={loaded} src={shot(view.current)} width={width - layout.sidebarWidth} height={height} alt={`${pageLabel} · ${lt("示例数据")}`} onLoad={() => setLoaded(true)} />
          <nav className="fl-demo-nav" aria-label={lt("演示侧栏")}>
            {hotspot(layout.create, "home", lt("新建对话"), false)}
            {layout.nav.map(row => hotspot(row, row.key, lt(navLabels[row.key])))}
            {layout.sessions.map(row => hotspot(row, row.key, `${lt("查看对话记录")}：${row.label}`))}
          </nav>
        </div>
      </div>
    </div>
  );
}
