import type { CSSProperties, ReactNode } from "react";
import { Icon, type V3IconName } from "./Icon";

// 插图零件：设计稿里的「迷你纸张」「小标签」「角标」等，全部用 div 按坐标拼出来。
// 坐标单位就是设计稿里的像素，放在 .v3-stage（position: relative）里使用。

type Box = { x: number; y: number; w: number; h: number };

export function Bar({ x, y, w, h, color = "var(--v3-sk)", r = 1, style }: Box & { color?: string; r?: number; style?: CSSProperties }) {
  return <span aria-hidden="true" style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: r, background: color, ...style }} />;
}

export function Paper({ x, y, w, h, r = 5, rotate, children, style, shadow = true, border = "var(--v3-cl)" }: Box & { r?: number; rotate?: number; children?: ReactNode; style?: CSSProperties; shadow?: boolean; border?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        overflow: "hidden",
        border: `1px solid ${border}`,
        borderRadius: r,
        background: "#fff",
        boxShadow: shadow ? "0 6px 16px rgb(0 0 0 / 6%)" : undefined,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// 迷你简历：标题条 + 三段内容线
export function MiniResume({ x, y, w, h, accent = "var(--v3-dark)", rotate, style }: Box & { accent?: string; rotate?: number; style?: CSSProperties }) {
  const pad = w * 0.1;
  const lines: ReactNode[] = [];
  let yy = h * 0.24;
  for (let s = 0; s < 3; s += 1) {
    lines.push(<Bar key={`h${s}`} x={pad} y={yy} w={w * 0.22} h={h * 0.028} color={accent === "var(--v3-dark)" ? "var(--v3-sub)" : accent} />);
    lines.push(<Bar key={`l${s}`} x={pad} y={yy + h * 0.045} w={w - 2 * pad} h={1} color="var(--v3-line)" />);
    yy += h * 0.07;
    for (let l = 0; l < (s === 1 ? 4 : 3); l += 1) {
      lines.push(<Bar key={`t${s}-${l}`} x={pad} y={yy} w={(w - 2 * pad) * (l % 3 === 2 ? 0.62 : 0.94)} h={h * 0.018} />);
      yy += h * 0.038;
    }
    yy += h * 0.035;
  }
  return (
    <Paper x={x} y={y} w={w} h={h} r={4} rotate={rotate} style={style}>
      <Bar x={pad} y={h * 0.08} w={w * 0.42} h={h * 0.045} color={accent} />
      <Bar x={pad} y={h * 0.145} w={w * 0.6} h={h * 0.022} color="var(--v3-sk2)" />
      {lines}
    </Paper>
  );
}

// 小文件：两条灰线 + 左下角格式标签
export function FilePaper({ x, y, w, h, tag, color, rotate }: Box & { tag?: string; color?: string; rotate?: number }) {
  const tw = tag && tag.length > 2 ? 30 : 24;
  return (
    <Paper x={x} y={y} w={w} h={h} rotate={rotate}>
      <Bar x={7} y={9} w={w * 0.55} h={4} color="var(--v3-sk2)" r={2} />
      <Bar x={7} y={18} w={w * 0.7} h={3} r={2} />
      <Bar x={7} y={25} w={w * 0.5} h={3} r={2} />
      {tag && (
        <span style={{ position: "absolute", left: 7, top: h - 20, display: "grid", width: tw, height: 13, placeItems: "center", borderRadius: 3, background: color, color: "#fff", fontFamily: "var(--v3-num)", fontSize: 7.5, fontWeight: 700 }}>{tag}</span>
      )}
    </Paper>
  );
}

// 圆形角标（黑底白图标，或浅色底）
export function Badge({ x, y, icon, fill = "var(--v3-dark)", color = "#fff", size = 22, border }: { x: number; y: number; icon: V3IconName; fill?: string; color?: string; size?: number; border?: string }) {
  return (
    <span aria-hidden="true" style={{ position: "absolute", left: x, top: y, display: "grid", width: size, height: size, placeItems: "center", border: border ? `1px solid ${border}` : undefined, borderRadius: size / 2, background: fill, color, boxShadow: "0 2px 6px rgb(0 0 0 / 10%)" }}>
      <Icon name={icon} size={Math.round(size * 0.55)} />
    </span>
  );
}

// 虚线箭头（插图里连接两个物件）
export function DashArrow({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <svg aria-hidden="true" style={{ position: "absolute", left: x, top: y }} width={w} height={14} viewBox={`0 0 ${w} 14`} fill="none">
      <path d={`M2 7h${w - 10}`} stroke="#b9b9b3" strokeWidth="1.4" strokeDasharray="3 3" />
      <path d={`M${w - 10} 3l5 4-5 4`} stroke="#b9b9b3" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 插图里的小标签（白底描边 + 圆点 + 文字）
export function TagCard({ x, y, text, dot, style }: { x: number; y: number; text: string; dot?: string; style?: CSSProperties }) {
  return (
    <span aria-hidden="true" style={{ position: "absolute", left: x, top: y, display: "inline-flex", height: 20, alignItems: "center", gap: 5, border: "1px solid var(--v3-cl)", borderRadius: 10, background: "#fff", padding: "0 8px", color: "var(--v3-sub)", fontSize: 9.5, fontWeight: 500, whiteSpace: "nowrap", boxShadow: "0 2px 6px rgb(0 0 0 / 6%)", ...style }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 3, background: dot }} />}
      {text}
    </span>
  );
}

export function Dot({ x, y, color, size = 6 }: { x: number; y: number; color: string; size?: number }) {
  return <span aria-hidden="true" style={{ position: "absolute", left: x, top: y, width: size, height: size, borderRadius: size / 2, background: color }} />;
}

export function StageText({ x, y, children, size = 10, color = "var(--v3-sub)", weight = 500, num = false, style }: { x: number; y: number; children: ReactNode; size?: number; color?: string; weight?: number; num?: boolean; style?: CSSProperties }) {
  return <span aria-hidden="true" style={{ position: "absolute", left: x, top: y, color, fontFamily: num ? "var(--v3-num)" : undefined, fontSize: size, fontWeight: weight, whiteSpace: "nowrap", ...style }}>{children}</span>;
}

// 居中定位容器：插图在舞台里水平居中（设计稿多数插图按舞台中心排）
export function Centered({ width, height, children, top = 0 }: { width: number; height: number; children: ReactNode; top?: number }) {
  return <span aria-hidden="true" style={{ position: "absolute", top, left: "50%", width, height, transform: "translateX(-50%)" }}>{children}</span>;
}

/* 01.1j 删除对话：对话卡片 + 红色垃圾桶角标（舞台 372×128） */
export function DeleteSessionArt() {
  return (
    <Centered width={372} height={128}>
      <Paper x={91} y={30} w={190} h={68} r={10} shadow={false}>
        <Bar x={14} y={14} w={130} h={22} r={11} color="var(--v3-field)" />
        <Bar x={24} y={21} w={80} h={6} r={3} color="var(--v3-sk)" />
        <Bar x={46} y={42} w={130} h={14} r={7} color="var(--v3-dark)" />
      </Paper>
      <Badge x={265} y={82} size={30} icon="trash" fill="var(--v3-rd-soft)" color="var(--v3-rd)" border="#f1d4d4" />
    </Centered>
  );
}
