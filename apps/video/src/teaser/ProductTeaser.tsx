import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource/noto-serif-sc/400.css";
import "@fontsource/noto-serif-sc/600.css";
import { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender } from "remotion";
import { APPLY_HAND, APPLY_SECONDS, ApplyScene } from "./apply";
import { Backdrop, PACE, Shot } from "./fx";
import { GraphScene } from "./graph";
import { INTERVIEW_HAND, INTERVIEW_SECONDS, InterviewScene } from "./interview";
import { OPENING_OUT, OpeningScene } from "./opening";
import { RESUME_HAND, RESUME_SECONDS, ResumeScene } from "./resume";

/** 脚本按约 41.5 秒编排，整体放慢 PACE 倍播放。 */
const SCRIPT_SECONDS = 41.5;
export const TEASER_SECONDS = Math.ceil(SCRIPT_SECONDS * PACE);

/* 一镜到底：每段在交接时刻把承接元素交给下一段，下一段原位接住。
 * 开场横线 → 扫描线；简历 → 缩略图；一面日程块 → 录音面板；模拟面试画面 → 图谱碎片。 */
const RESUME_AT = OPENING_OUT + 0.15;
const APPLY_AT = RESUME_AT + RESUME_HAND;
const INTERVIEW_AT = APPLY_AT + APPLY_HAND;
const GRAPH_AT = INTERVIEW_AT + INTERVIEW_HAND;

/** 约 54 秒的产品短片：黑白编辑风格的抽象画面。简历 → 投递 → 面试三段为能力图谱提供数据，
 * 图谱段聚焦短板并专项补强，最后拉远落版。 */
export function ProductTeaser() {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => { document.fonts.ready.then(() => continueRender(handle)); }, [handle]);
  return <AbsoluteFill>
    <Backdrop />
    {/* 开场横线停在落版位置，简历镜头 0.3 秒后接手移动 */}
    <Shot from={0} seconds={RESUME_AT + 0.3}><OpeningScene /></Shot>
    <Shot from={RESUME_AT} seconds={RESUME_SECONDS}><ResumeScene /></Shot>
    <Shot from={APPLY_AT} seconds={APPLY_SECONDS}><ApplyScene /></Shot>
    <Shot from={INTERVIEW_AT} seconds={INTERVIEW_SECONDS}><InterviewScene /></Shot>
    <Shot from={GRAPH_AT} seconds={TEASER_SECONDS / PACE - GRAPH_AT}><GraphScene /></Shot>
  </AbsoluteFill>;
}
