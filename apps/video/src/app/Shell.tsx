import type { ReactNode } from "react";
import { AbsoluteFill, Img } from "remotion";
import { BriefcaseBusiness, CalendarDays, FileText, Folder, LayoutTemplate, Mic, Plus, Sun } from "lucide-react";
import mark from "@web-assets/linkresume-wordmark.png";
import { c, font, app } from "./theme";
import { easeInOut, keyframes, mix, ramp, useT } from "./anim";

export type NavKey = "home" | "resumes" | "templates" | "jobs" | "schedule" | "mock" | "datasets" | "chat";
const nav: { key: NavKey; label: string; icon: ReactNode; count?: number }[] = [
  { key: "home", label: "首页", icon: <Sun size={16} /> },
  { key: "resumes", label: "我的简历", icon: <FileText size={16} />, count: 3 },
  { key: "templates", label: "简历模板", icon: <LayoutTemplate size={16} /> },
  { key: "jobs", label: "岗位看板", icon: <BriefcaseBusiness size={16} />, count: 8 },
  { key: "schedule", label: "面试日程", icon: <CalendarDays size={16} /> },
  { key: "mock", label: "模拟面试", icon: <Mic size={16} /> },
  { key: "datasets", label: "资料库", icon: <Folder size={16} /> },
];
const recent = ["按星河科技 JD 改简历", "准备今天的产品经理面试", "分析高级产品经理岗位", "打磨两分钟自我介绍"];
const navY = (key: NavKey) => (key === "chat" ? 404 : 110 + nav.findIndex((item) => item.key === key) * 38);

/** 侧栏：选中背景从上一页滑到当前页。 */
function Sidebar({ active, from, switchAt }: { active: NavKey; from?: NavKey; switchAt: number }) {
  const t = useT();
  const p = from ? ramp(t, switchAt, 0.4, easeInOut) : 1;
  const y = mix(navY(from ?? active), navY(active), p);
  return <div style={{ position: "absolute", left: 0, top: 0, width: app.sidebar, height: app.height, background: c.canvas, fontFamily: font.sans, color: c.ink }}>
    <Img src={mark} style={{ position: "absolute", left: 22, top: 20, width: 136, height: 28, objectFit: "contain", objectPosition: "left" }} />
    <div style={{ position: "absolute", left: 14, top: 64, width: 188, height: 34, display: "flex", alignItems: "center", gap: 10, padding: "0 12px", fontSize: 14 }}><Plus size={16} />新建对话</div>
    <div style={{ position: "absolute", left: 14, top: y, width: 188, height: 34, borderRadius: 10, background: c.navActive }} />
    {nav.map((item) => <div key={item.key} style={{ position: "absolute", left: 14, top: navY(item.key), width: 188, height: 34, display: "flex", alignItems: "center", gap: 10, padding: "0 12px", fontSize: 14 }}>
      {item.icon}<span style={{ flex: 1 }}>{item.label}</span>{item.count ? <span style={{ color: c.mute, fontSize: 13 }}>{item.count}</span> : null}
    </div>)}
    <div style={{ position: "absolute", left: 26, top: 384, fontSize: 12, color: c.mute }}>最近对话</div>
    {recent.map((title, i) => <div key={title} style={{ position: "absolute", left: 14, top: 404 + i * 34, width: 188, height: 32, display: "flex", alignItems: "center", padding: "0 12px", fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden" }}>{title}</div>)}
    <div style={{ position: "absolute", left: 20, bottom: 22, display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 34, height: 34, borderRadius: "50%", background: c.ink, color: "#fff", display: "grid", placeItems: "center", fontSize: 14 }}>张</span>
      <span style={{ fontSize: 13, lineHeight: "18px" }}>张三<br /><span style={{ color: c.mute, fontSize: 12 }}>zhangsan@example.com</span></span>
    </div>
  </div>;
}

export type CameraKey = { at: number; x: number; y: number; zoom: number };
export type CursorKey = { at: number; x: number; y: number; click?: boolean; hide?: boolean };
export type Caption = { at: number; text: ReactNode };

const full: CameraKey = { at: 0, x: app.width / 2, y: app.height / 2, zoom: 1 };

/** 假鼠标：在关键帧之间缓动移动，click 时按下并扩散一圈。 */
function Cursor({ keys }: { keys: CursorKey[] }) {
  const t = useT();
  if (!keys.length) return null;
  const { x, y } = keyframes(keys.map(({ at, x, y }) => ({ at, x, y })), t);
  const firstShow = keys[0].at;
  const hideAt = keys.find((k) => k.hide)?.at ?? Infinity;
  const opacity = Math.min(ramp(t, firstShow - 0.3, 0.3), 1 - ramp(t, hideAt, 0.3));
  let press = 0;
  let ring = -1;
  for (const k of keys) {
    if (!k.click) continue;
    const d = t - k.at;
    if (d >= -0.08 && d <= 0.22) press = Math.max(press, 1 - Math.abs(d - 0.05) / 0.17);
    if (d >= 0 && d <= 0.5) ring = d / 0.5;
  }
  return <>
    {ring >= 0 && <div style={{ position: "absolute", left: x - 18, top: y - 18, width: 36, height: 36, borderRadius: "50%", border: `2px solid ${c.blue}`, opacity: (1 - ring) * 0.6, transform: `scale(${0.4 + ring})` }} />}
    <svg width="22" height="24" viewBox="0 0 20 22" style={{ position: "absolute", left: x - 3, top: y - 2, opacity, transform: `scale(${1 - press * 0.15})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 2px 3px #0000003a)" }}>
      <path d="M3 2.5v15.2l4-3.7 2.6 5.8 2.8-1.2-2.6-5.7h5.6L3 2.5Z" fill="#17191c" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  </>;
}

/** 字幕：画面下方白底区域，按时间切换。 */
function Captions({ items }: { items: Caption[] }) {
  const t = useT();
  return <>{items.map((item, i) => {
    const next = items[i + 1]?.at;
    const enter = ramp(t, item.at, 0.4);
    const leave = next === undefined ? 1 : 1 - ramp(t, next - 0.25, 0.25);
    const o = Math.min(enter, leave);
    return o > 0 ? <div key={i} style={{ position: "absolute", left: 0, right: 0, top: 1000, textAlign: "center", fontFamily: font.sans, fontSize: 30, lineHeight: "44px", color: c.ink, opacity: o, transform: `translateY(${(1 - enter) * 10}px)` }}>{item.text}</div> : null;
  })}</>;
}

export const WINDOW = { scale: 1.08, left: (1920 - app.width * 1.08) / 2, top: 18 };

/**
 * 工作区窗口：真实产品布局（侧栏 + 白色内容面板），镜头在窗口内推拉，
 * 光标与内容一起缩放；字幕位于窗口下方。
 */
export function Shell({ active, from, switchAt = 0, camera = [full], cursor = [], captions = [], children, overlay }: {
  active: NavKey; from?: NavKey; switchAt?: number; camera?: CameraKey[]; cursor?: CursorKey[]; captions?: Caption[]; children: ReactNode; overlay?: ReactNode;
}) {
  const t = useT();
  const { x, y, zoom } = keyframes(camera.map(({ at, x, y, zoom }) => ({ at, x, y, zoom })), t);
  // 镜头不越出画面：缩放后的内容始终铺满窗口。
  const tx = Math.min(0, Math.max(app.width - app.width * zoom, app.width / 2 - x * zoom));
  const ty = Math.min(0, Math.max(app.height - app.height * zoom, app.height / 2 - y * zoom));
  return <AbsoluteFill style={{ background: "#fff" }}>
    <div style={{ position: "absolute", left: WINDOW.left, top: WINDOW.top, width: app.width, height: app.height, transform: `scale(${WINDOW.scale})`, transformOrigin: "0 0", borderRadius: 14, overflow: "hidden", boxShadow: "0 0 0 1px #17191c14, 0 24px 70px #17191c1f", background: c.canvas }}>
      <div style={{ position: "absolute", inset: 0, transform: `translate(${tx}px, ${ty}px) scale(${zoom})`, transformOrigin: "0 0" }}>
        <Sidebar active={active} from={from} switchAt={switchAt} />
        <div style={{ position: "absolute", left: app.panelX, top: app.panelY, width: app.panelW, height: app.panelH, borderRadius: 12, background: c.panel, boxShadow: "0 0 0 1px #17191c0d", overflow: "hidden", fontFamily: font.sans, color: c.ink }}>{children}</div>
        {overlay}
        <Cursor keys={cursor} />
      </div>
    </div>
    <Captions items={captions} />
  </AbsoluteFill>;
}
