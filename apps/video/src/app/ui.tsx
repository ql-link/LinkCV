import type { CSSProperties, ReactNode } from "react";
import { c, font } from "./theme";

export function PageHeader({ eyebrow, title, sub, actions }: { eyebrow: string; title: string; sub: ReactNode; actions?: ReactNode }) {
  return <div style={{ position: "absolute", left: 50, right: 50, top: 60, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
    <div>
      <p style={{ margin: 0, fontSize: 12, letterSpacing: 0.3, color: c.mute }}>{eyebrow}</p>
      <h1 style={{ margin: "8px 0 0", fontFamily: font.serif, fontSize: 30, lineHeight: "38px", fontWeight: 500 }}>{title}</h1>
      <p style={{ margin: "8px 0 0", fontSize: 14, color: c.mute }}>{sub}</p>
    </div>
    {actions && <div style={{ display: "flex", gap: 10, paddingBottom: 30 }}>{actions}</div>}
  </div>;
}

export function Button({ children, primary, style }: { children: ReactNode; primary?: boolean; style?: CSSProperties }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 16px", borderRadius: 999, fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", background: primary ? c.ink : "#fff", color: primary ? "#fff" : c.ink, boxShadow: primary ? "none" : `inset 0 0 0 1px ${c.line2}`, ...style }}>{children}</span>;
}

export function Tag({ children, tone = "gray", style }: { children: ReactNode; tone?: "gray" | "blue" | "orange" | "green" | "dark"; style?: CSSProperties }) {
  const tones = { gray: [c.soft, c.text], blue: [c.blueSoft, c.blue], orange: [c.orangeSoft, c.orange], green: [c.greenSoft, c.green], dark: [c.ink, "#fff"] } as const;
  const [bg, fg] = tones[tone];
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 22, padding: "0 8px", borderRadius: 6, background: bg, color: fg, fontSize: 12, whiteSpace: "nowrap", ...style }}>{children}</span>;
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ position: "absolute", borderRadius: 14, background: "#fff", boxShadow: `0 0 0 1px ${c.line}, 0 1px 2px #17191c08`, ...style }}>{children}</div>;
}

export function Dot({ color, size = 6 }: { color: string; size?: number }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0 }} />;
}

/** 浮层弹窗：遮罩 + 居中卡片，p 为 0→1 出现进度。 */
export function Modal({ p, width, height, children }: { p: number; width: number; height: number; children: ReactNode }) {
  if (p <= 0) return null;
  return <div style={{ position: "absolute", inset: 0, background: `rgba(23,25,28,${0.18 * p})` }}>
    <div style={{ position: "absolute", left: (1440 - width) / 2, top: (900 - height) / 2, width, height, borderRadius: 16, background: "#fff", boxShadow: "0 30px 80px #17191c33", opacity: p, transform: `translateY(${(1 - p) * 16}px) scale(${0.97 + p * 0.03})`, fontFamily: font.sans, color: c.ink, overflow: "hidden" }}>{children}</div>
  </div>;
}

/** 文字行骨架（用于缩略图）。 */
export function Lines({ widths, gap = 6, h = 4, color = "#e6e6e3" }: { widths: number[]; gap?: number; h?: number; color?: string }) {
  return <div style={{ display: "flex", flexDirection: "column", gap }}>{widths.map((w, i) => <div key={i} style={{ width: `${w}%`, height: h, borderRadius: h, background: color }} />)}</div>;
}
