import { t, useLocale, getLocale } from "@/i18n";
// 语音面试各页面共用的小件：波形、计时格式、面试官头像（羽毛）、用户头像。
import type { CSSProperties } from "react";
import feather from "@/features/assistant/assistant-assets/assistant-feather.png";
import { useResumeStore } from "@/store/resumeStore";

// 毫秒 → m:ss（录音时长、作答时长）
export function formatClock(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// 毫秒 → mm:ss（面试总用时，设计稿「18:42」）
export function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// 竖条波形：values 取 0–1，按 min/max 映射成条高；用于作答中、语音输入和设备检测
export function Waveform({
  values,
  barWidth,
  gap,
  height,
  minHeight = 3,
  color = "var(--v3-dark)",
  idleColor,
  threshold = 0,
  className = "",
  style,
}: {
  values: number[];
  barWidth: number;
  gap: number;
  height: number;
  minHeight?: number;
  color?: string;
  idleColor?: string;
  threshold?: number;
  className?: string;
  style?: CSSProperties;
}) {
  useLocale();
  return (
    <span className={`vx-wave ${className}`} aria-hidden="true" style={{ height, gap, ...style }}>
      {values.map((value, index) => {
        const lit = value > threshold;
        return (
          <i
            key={index}
            style={{
              width: barWidth,
              height: Math.max(minHeight, Math.round(minHeight + (height - minHeight) * Math.min(1, value))),
              borderRadius: barWidth / 2,
              background: lit || !idleColor ? color : idleColor,
            }}
          />
        );
      })}
    </span>
  );
}

// 取最近 count 个音量样本（不足时左侧补 0）
export function lastSamples(history: number[], count: number) {
  const slice = history.slice(-count);
  return slice.length >= count ? slice : [...Array<number>(count - slice.length).fill(0), ...slice];
}

export function FeatherOrb({ size, ring = "var(--v3-cl)", icon, className = "", style }: { size: number; ring?: string; icon: number; className?: string; style?: CSSProperties }) {
  useLocale();
  return (
    <span className={`vx-orb ${className}`} style={{ width: size, height: size, borderColor: ring, ...style }} aria-hidden="true">
      <img src={feather} alt="" style={{ width: icon, height: Math.round(icon * 0.96) }} />
    </span>
  );
}

export function FeatherMark({ size = 24 }: { size?: number }) {
  useLocale();
  return <img className="vx-feather-mark" src={feather} alt="" aria-hidden="true" style={{ width: size, height: Math.round(size * 0.96) }} />;
}

export function useUserInitial() {
  const user = useResumeStore((state) => state.user);
  const name = user?.nickname || user?.email || t("我");
  return [...name][0] ?? t("我");
}

export function UserAvatar({ size, fontSize, className = "", style }: { size: number; fontSize: number; className?: string; style?: CSSProperties }) {
  useLocale();
  const initial = useUserInitial();
  return (
    <span className={`vx-user ${className}`} style={{ width: size, height: size, fontSize, ...style }} aria-hidden="true">
      {initial}
    </span>
  );
}

export const EXPECTED_DEPTH: Record<string, number> = { junior: 2, intermediate: 3, senior: 4 };
