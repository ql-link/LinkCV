import { useId } from "react";

// 完整度仪表盘（Figma lib12 · ewGauge）：240° 圆弧、底部开口；浅灰轨道 + 灰到黑渐变数值弧 + 末端白色旋钮。
// 大号带刻度（每 5 分一格，20 的倍数和 40 / 70 / 90 三个等级分界加长）；mini 为顶栏 18×16 小号，无刻度。
const A0 = 150;
const SWEEP = 240;

export function gaugeGeometry(mini: boolean, extra = 0) {
  const r = mini ? 7 : 78;
  const sw = mini ? 3 : 10;
  const pad = mini ? 2 : 18;
  const width = Math.ceil(2 * (r + pad));
  const cx = width / 2;
  const cy = r + pad;
  const height = Math.ceil(cy + r * 0.5 + sw / 2 + 2 + extra);
  return { r, sw, pad, width, height, cx, cy };
}

export function WorkbenchGauge({ score, mini = false, extra = 0, className }: { score: number; mini?: boolean; extra?: number; className?: string }) {
  const gradientId = useId().replace(/:/g, "");
  const { r, sw, width, height, cx, cy } = gaugeGeometry(mini, extra);
  const point = (angle: number, radius: number) => [
    cx + radius * Math.cos((angle * Math.PI) / 180),
    cy + radius * Math.sin((angle * Math.PI) / 180),
  ];
  const f = (value: number) => value.toFixed(2);
  const arc = (a1: number, a2: number) => {
    const [x1, y1] = point(a1, r);
    const [x2, y2] = point(a2, r);
    return `M${f(x1)} ${f(y1)}A${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${f(x2)} ${f(y2)}`;
  };
  // 与设计稿一致：分数过低时仍保留一小段弧，旋钮不贴在起点
  const end = A0 + (SWEEP * Math.max(0.5, Math.min(100, score))) / 100;
  const [kx, ky] = point(end, r);
  const ticks = mini ? [] : Array.from({ length: 21 }, (_, index) => {
    const value = index * 5;
    const angle = A0 + (SWEEP * value) / 100;
    const level = value === 40 || value === 70 || value === 90;
    const major = value % 20 === 0 || level;
    const r1 = r + sw / 2 + 5;
    const [x1, y1] = point(angle, r1);
    const [x2, y2] = point(angle, r1 + (major ? 6 : 3));
    return (
      <line
        key={value}
        x1={f(x1)} y1={f(y1)} x2={f(x2)} y2={f(y2)}
        stroke={level ? "#96968f" : major ? "#c4c4be" : "#dcdcd8"}
        strokeWidth={level ? 1.4 : 1}
        strokeLinecap="round"
      />
    );
  });

  return (
    <svg aria-hidden="true" className={className} width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#a3a39c" />
          <stop offset="1" stopColor="#1d1d1b" />
        </linearGradient>
      </defs>
      <path d={arc(A0, A0 + SWEEP)} stroke="#ececea" strokeWidth={sw} strokeLinecap="round" />
      <path d={arc(A0, end)} stroke={`url(#${gradientId})`} strokeWidth={sw} strokeLinecap="round" />
      {ticks}
      {!mini && <circle cx={f(kx)} cy={f(ky)} r={sw * 1.05} fill="#1d1d1b" fillOpacity={0.08} />}
      <circle cx={f(kx)} cy={f(ky)} r={f(sw * (mini ? 0.62 : 0.78))} fill="#ffffff" stroke="#1d1d1b" strokeWidth={f(sw * (mini ? 0.34 : 0.3))} />
    </svg>
  );
}
