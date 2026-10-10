import { useEffect, useState } from "react";
import { useLocale } from "@/i18n";
import { lt } from "./landingCopy";

/**
 * Hero 互动演示：真实产品界面在 1440×900 视口下的静态截图（`scripts/capture-landing-demo.mjs` 生成）。
 * 只渲染工作区窗口内部，由 `HeroShowcase` 负责缩放、短片播放和拼装过渡。
 * 只有侧栏可点击：切换页面或查看对话记录；其余区域不响应。选中项用半透明圆角色块滑动表示，
 * 不使用混合模式，避免与 Hero 背景的蓝色光场混色；新页面叠在旧页面上淡入，旧页面淡入结束后再移除。
 */
export type DemoRow = { key: string; x: number; y: number; width: number; height: number };
export type DemoLayout = { viewport: { width: number; height: number }; sidebarWidth: number; create: Omit<DemoRow, "key">; nav: DemoRow[]; sessions: (DemoRow & { label: string })[] };

const shots = import.meta.glob<string>("./demo-shots/*/*.webp", { eager: true, query: "?url", import: "default" });
const layouts = import.meta.glob<DemoLayout>("./demo-shots/*/layout.json", { eager: true, import: "default" });
const navLabels: Record<string, string> = { home: "首页", resumes: "我的简历", templates: "简历模板", jobs: "岗位看板", schedule: "面试日程", mock: "模拟面试", datasets: "资料库" };

export function useDemoShots() {
  const locale = useLocale();
  const folder = locale === "en-US" ? "en-US" : "zh-CN";
  return { folder, layout: layouts[`./demo-shots/${folder}/layout.json`], shot: (key: string) => shots[`./demo-shots/${folder}/${key}.webp`] };
}

function prefetch(url: string) {
  const image = new Image();
  image.src = url;
}

export function HeroDemo() {
  const { folder, layout, shot } = useDemoShots();
  const [view, setView] = useState({ current: "home", previous: "home" });
  const [loaded, setLoaded] = useState(true);

  // 演示出现后预载其余页面，切换时不再等待下载
  useEffect(() => {
    [...layout.nav, ...layout.sessions].forEach(row => prefetch(shot(row.key)));
  }, [folder]);

  const { width, height } = layout.viewport;
  const chat = layout.sessions.find(row => row.key === view.current);
  const selected = chat ?? layout.nav.find(row => row.key === view.current) ?? layout.nav[0];
  const show = (key: string) => {
    if (key === view.current) return;
    setLoaded(false);
    setView({ current: key, previous: view.current });
  };
  const pageLabel = chat ? chat.label : lt(navLabels[view.current]);
  const hotspot = (row: Omit<DemoRow, "key">, key: string, label: string, selectable = true) => <button
    key={`${key}-${row.y}`}
    type="button"
    className="fl-demo-hotspot"
    style={{ left: row.x, top: row.y, width: row.width, height: row.height }}
    aria-label={label}
    aria-current={selectable && key === view.current ? "page" : undefined}
    onClick={() => show(key)}
  />;

  return <>
    <img className="fl-demo-sidebar" src={shot("sidebar")} width={layout.sidebarWidth} height={height} alt="" />
    <span className="fl-demo-slider" aria-hidden="true" style={{ left: selected.x, width: selected.width, height: selected.height, transform: `translateY(${selected.y}px)` }} />
    {view.previous !== view.current && <img className="fl-demo-page" src={shot(view.previous)} width={width - layout.sidebarWidth} height={height} alt="" />}
    <img key={`${folder}-${view.current}`} className="fl-demo-page" data-loaded={loaded} src={shot(view.current)} width={width - layout.sidebarWidth} height={height} alt={`${pageLabel} · ${lt("示例数据")}`} onLoad={() => setLoaded(true)} />
    <nav className="fl-demo-nav" aria-label={lt("演示侧栏")}>
      {hotspot(layout.create, "home", lt("新建对话"), false)}
      {layout.nav.map(row => hotspot(row, row.key, lt(navLabels[row.key])))}
      {layout.sessions.map(row => hotspot(row, row.key, `${lt("查看对话记录")}：${row.label}`))}
    </nav>
  </>;
}
