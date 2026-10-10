import type { ReactNode } from "react";
import { AbsoluteFill, Img } from "remotion";
import wordmark from "@web-assets/linkresume-wordmark.png";
import { c, font } from "../app/theme";
import { fadeUp, ramp, useT } from "../app/anim";
import { Shell, type CameraKey } from "../app/Shell";
import { HomePage } from "../pages/Home";
import { DatasetsPage } from "../pages/Datasets";
import { ResumeImportOverlay, ResumesPage } from "../pages/Resumes";
import { JobImportOverlay, JobsPage } from "../pages/Jobs";
import { ChatPage } from "../pages/Chat";
import { JobDetailPage } from "../pages/JobDetail";
import { MockDashboardPage, MockReportOverlay, MockSessionPage } from "../pages/Mock";

/** 面板内坐标 → 工作区坐标。 */
const P = (x: number, y: number) => ({ x: x + 228, y: y + 12 });
const cam = (at: number, x: number, y: number, zoom: number): CameraKey => ({ at, x, y, zoom });
const FULL = (at: number) => cam(at, 720, 450, 1);
const navPoint = (index: number) => ({ x: 70, y: 127 + index * 38 });
const NAV = { home: 0, resumes: 1, templates: 2, jobs: 3, schedule: 4, mock: 5, datasets: 6 };

/** 时间跳转提示：窗口顶部居中的小标签。 */
function TimeSkip({ label }: { label: string }) {
  const t = useT();
  const o = Math.min(ramp(t, 0.15, 0.3), 1 - ramp(t, 1.9, 0.4));
  return <div style={{ position: "absolute", left: 0, right: 0, top: 24, display: "flex", justifyContent: "center", opacity: o }}>
    <span style={{ padding: "6px 14px", borderRadius: 999, background: c.ink, color: "#fff", fontFamily: font.sans, fontSize: 14 }}>{label}</span>
  </div>;
}

const steps = ["准备材料", "改简历", "投递", "面试", "复盘", "练习"];

export function Opening() {
  const t = useT();
  return <AbsoluteFill style={{ background: "#fff", fontFamily: font.sans, color: c.ink, alignItems: "center", justifyContent: "center" }}>
    <p style={{ margin: 0, fontFamily: font.serif, fontSize: 64, fontWeight: 500, letterSpacing: -1, ...fadeUp(t, 0.3, 20, 0.7) }}>从投出简历到拿到 Offer，</p>
    <p style={{ margin: "14px 0 0", fontFamily: font.serif, fontSize: 64, fontWeight: 500, letterSpacing: -1, ...fadeUp(t, 0.9, 20, 0.7) }}>中间有很多步。</p>
    <div style={{ marginTop: 56, display: "flex", alignItems: "center", gap: 14 }}>
      {steps.map((s, i) => <span key={s} style={{ display: "flex", alignItems: "center", gap: 14, ...fadeUp(t, 1.8 + i * 0.22, 10, 0.4) }}>
        <span style={{ padding: "10px 20px", borderRadius: 999, fontSize: 24, background: ramp(t, 3.4 + i * 0.12, 0.2) > 0.5 ? c.ink : c.soft, color: ramp(t, 3.4 + i * 0.12, 0.2) > 0.5 ? "#fff" : c.text }}>{s}</span>
        {i < steps.length - 1 && <span style={{ color: c.faint, fontSize: 22 }}>→</span>}
      </span>)}
    </div>
  </AbsoluteFill>;
}

export function HomeStart() {
  return <Shell active="home" camera={[cam(0, 828, 300, 1.7), cam(0.6, 828, 300, 1.7), FULL(2.6)]}
    cursor={[{ at: 4.4, x: 760, y: 620 }, { ...navPoint(NAV.datasets), at: 5.7, click: true }]}
    captions={[{ at: 0.4, text: "LinkResume 陪你走完求职的每一步。" }]}><HomePage /></Shell>;
}

export function DatasetsScene() {
  const f = P(230, 340);
  return <Shell active="datasets" from="home" switchAt={0} camera={[FULL(0), FULL(1.3), cam(2.2, f.x + 200, f.y + 40, 1.35), cam(4.0, f.x + 200, f.y + 40, 1.35), FULL(5.0)]}
    cursor={[{ at: 1.3, x: 1440, y: 560 }, { at: 1.6, x: 1425, y: 545, click: true }, { at: 3.0, x: 392, y: 316 }, { at: 3.6, x: 420, y: 330 }, { ...navPoint(NAV.resumes), at: 5.4, click: true }]}
    captions={[{ at: 0.3, text: "先把项目复盘、作品集放进资料库。" }]}><DatasetsPage dropAt={3.0} /></Shell>;
}

export function ResumesScene() {
  return <Shell active="resumes" from="datasets" camera={[FULL(0), FULL(1.2), cam(2.0, 720, 450, 1.35), cam(4.4, 720, 450, 1.35), FULL(5.2)]}
    cursor={[{ at: 0.2, ...navPoint(NAV.resumes) }, { at: 1.0, x: 1230, y: 111, click: true }, { at: 4.6, x: 868, y: 612, click: true }, { ...navPoint(NAV.jobs), at: 6.4, click: true }]}
    captions={[{ at: 0.3, text: "已有简历直接导入，自动识别各个模块。" }]}
    overlay={<ResumeImportOverlay openAt={1.1} parsedAt={2.6} importAt={4.6} />}><ResumesPage openAt={1.1} parsedAt={2.6} importAt={4.6} /></Shell>;
}

export function JobsImportScene() {
  const col = P(153, 392);
  return <Shell active="jobs" from="resumes" camera={[FULL(0), FULL(1.2), cam(2.0, 720, 450, 1.25), cam(4.7, 720, 450, 1.25), FULL(5.3), cam(6.1, col.x + 120, col.y, 1.5)]}
    cursor={[{ at: 0.2, ...navPoint(NAV.jobs) }, { at: 1.0, x: 1334, y: 111, click: true }, { at: 1.7, x: 560, y: 420, click: true }, { at: 4.8, x: 1033, y: 624, click: true }, { at: 5.4, x: 1100, y: 700, hide: true }]}
    captions={[{ at: 0.3, text: "看中一个岗位，粘贴招聘信息就能收进看板。" }]}
    overlay={<JobImportOverlay openAt={1.1} pasteAt={1.8} parsedAt={3.0} saveAt={4.8} />}><JobsPage mode="import" at={5.1} /></Shell>;
}

export function ChatScene() {
  const composer = P(360, 806);
  const proposal = P(330, 415);
  const line = P(960, 300);
  return <Shell active="chat" from="jobs" camera={[cam(0, composer.x, composer.y - 60, 1.5), cam(3.0, composer.x, composer.y - 60, 1.5), FULL(4.0), FULL(6.9), cam(7.8, proposal.x, proposal.y, 1.45), cam(9.2, proposal.x, proposal.y, 1.45), cam(10.2, line.x, line.y, 1.7), cam(13.2, line.x, line.y, 1.7), FULL(14.3)]}
    cursor={[{ at: 0.3, x: 520, y: 760 }, { at: 0.7, x: 430, y: 790, click: true }, { at: 2.8, x: 859, y: 836 }, { at: 3.0, x: 859, y: 836, click: true }, { at: 3.4, x: 900, y: 860, hide: true }]}
    captions={[{ at: 0.3, text: "按这个岗位改简历，把项目资料一起交给它。" }, { at: 6.8, text: "它从你的项目里，找回简历上漏掉的成果。" }, { at: 9.4, text: "每一处修改，都由你确认后才写进简历。" }]}><ChatPage typeAt={0.9} sendAt={3.0} applyAt={9.0} /><ApplyCursor /></Shell>;
}

/** 采用按钮的点击放在独立光标里，避免与发送阶段的隐藏冲突。 */
function ApplyCursor() {
  const t = useT();
  if (t < 7.9 || t > 9.8) return null;
  const p = ramp(t, 7.9, 1.0);
  const press = t > 8.95 && t < 9.15 ? 0.85 : 1;
  const x = 760 + (592 - 760) * p;
  const y = 640 + (518 - 640) * p;
  return <svg width="22" height="24" viewBox="0 0 20 22" style={{ position: "absolute", left: x - 3, top: y - 2, opacity: Math.min(ramp(t, 7.9, 0.3), 1 - ramp(t, 9.5, 0.3)), transform: `scale(${press})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 2px 3px #0000003a)" }}>
    <path d="M3 2.5v15.2l4-3.7 2.6 5.8 2.8-1.2-2.6-5.7h5.6L3 2.5Z" fill="#17191c" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>;
}

export function JobsAdvanceScene() {
  const from = P(103 + 50, 392);
  const to = P(50 + 4 * 216 + 103, 392);
  return <Shell active="jobs" from="chat" camera={[FULL(0), cam(1.0, 860, 420, 1.12), cam(3.4, 860, 420, 1.12), FULL(4.4)]}
    cursor={[{ at: 0.6, x: from.x + 20, y: from.y + 30 }, { at: 1.1, x: from.x, y: from.y, click: true }, { at: 2.7, x: to.x, y: to.y }, { at: 4.6, x: to.x, y: to.y }, { at: 5.2, x: to.x, y: to.y, click: true }]}
    captions={[{ at: 0.3, text: "投出去之后，推进到哪一步，拖一下就更新。" }]}
    overlay={<TimeSkip label="3 天后 · 收到一面邀约" />}><JobsPage mode="advance" at={1.2} /></Shell>;
}

export function ReviewScene() {
  const left = P(320, 420);
  const right = P(880, 460);
  const weak = P(880, 520);
  return <Shell active="jobs" camera={[FULL(0), FULL(0.9), cam(1.8, left.x, left.y, 1.35), cam(3.6, left.x, left.y, 1.35), cam(4.6, right.x, right.y, 1.35), cam(5.8, right.x, right.y, 1.35), cam(6.6, weak.x, weak.y, 1.7), cam(9.6, weak.x, weak.y, 1.7), FULL(10.6)]}
    cursor={[{ at: 0.4, x: 700, y: 500 }, { at: 1.0, ...P(320, 330), click: true }, { at: 1.5, x: 640, y: 420, hide: true }]}
    captions={[{ at: 0.3, text: "一面结束，上传录音，自动转成文字稿。" }, { at: 4.0, text: "AI 结合简历和岗位要求帮你复盘，" }, { at: 6.2, text: "哪道题没答好，一清二楚。" }]}
    overlay={<TimeSkip label="10-09 · 一面结束" />}><JobDetailPage variant="review" at={1.2} /></Shell>;
}

export function PrepScene() {
  const list = P(880, 400);
  return <Shell active="jobs" camera={[FULL(0), FULL(0.8), cam(1.8, list.x, list.y, 1.45), cam(4.9, list.x, list.y, 1.45)]}
    cursor={[{ at: 2.6, x: 1180, y: 480 }, { at: 4.4, ...P(880, 550), click: true }]}
    captions={[{ at: 0.3, text: "二面排上了，准备清单还差最后一项。" }]}
    overlay={<TimeSkip label="一周后 · 二面当天" />}><JobDetailPage variant="prep" at={4.4} /></Shell>;
}

export function MockSessionScene() {
  const thread = P(600, 330);
  const follow = P(600, 480);
  return <Shell active="mock" from="jobs" camera={[FULL(0), FULL(0.7), cam(1.6, thread.x, thread.y, 1.35), cam(4.9, thread.x, thread.y + 60, 1.35), cam(5.7, follow.x, follow.y, 1.6), cam(7.3, follow.x, follow.y, 1.6), FULL(8.0), FULL(8.6), cam(9.4, 720, 450, 1.25)]}
    cursor={[{ at: 7.2, x: 1100, y: 300 }, { at: 7.9, x: 1330, y: 64, click: true }, { at: 8.4, x: 1300, y: 140, hide: true }]}
    captions={[{ at: 0.3, text: "二面之前，按这个岗位再练一轮。" }, { at: 4.9, text: "它会顺着你的回答追问，" }, { at: 8.3, text: "结束给出评分和改进建议。" }]}
    overlay={<MockReportOverlay openAt={8.2} />}><MockSessionPage answerAt={1.4} followAt={4.9} /></Shell>;
}

export function DashboardScene() {
  const radar = P(947, 470);
  const trend = P(527, 440);
  return <Shell active="mock" camera={[FULL(0), FULL(0.9), cam(1.8, radar.x, radar.y, 1.6), cam(3.6, radar.x, radar.y, 1.6), cam(4.4, trend.x, trend.y, 1.45), cam(5.6, trend.x, trend.y, 1.45), FULL(6.4)]}
    captions={[{ at: 0.3, text: "练得越多，哪项在进步，看得见。" }]}><MockDashboardPage at={1.4} /></Shell>;
}

export function HomeEnd() {
  const card = P(353, 660);
  return <Shell active="home" from="mock" camera={[FULL(0), FULL(1.6), cam(2.6, card.x, card.y - 60, 1.5), cam(5.2, card.x, card.y - 60, 1.5)]}
    captions={[{ at: 0.3, text: "每一次经历，都成为下一次准备的依据。" }]}><HomePage variant="after" /></Shell>;
}

export function Ending() {
  const t = useT();
  return <AbsoluteFill style={{ background: "#fff", fontFamily: font.sans, color: c.ink, alignItems: "center", justifyContent: "center" }}>
    <Img src={wordmark} style={{ width: 420, height: 86, objectFit: "contain", ...fadeUp(t, 0.3, 16, 0.7) }} />
    <p style={{ margin: "36px 0 0", fontFamily: font.serif, fontSize: 60, fontWeight: 500, letterSpacing: -1, ...fadeUp(t, 0.7, 16, 0.7) }}>懂你经历的求职搭档</p>
    <span style={{ marginTop: 52, height: 68, padding: "0 42px", borderRadius: 999, background: c.ink, color: "#fff", fontSize: 26, fontWeight: 500, display: "flex", alignItems: "center", ...fadeUp(t, 1.1, 12) }}>免费开始 →</span>
    <p style={{ margin: "24px 0 0", fontSize: 24, color: c.mute, letterSpacing: 1, ...fadeUp(t, 1.4, 10) }}>linkresume.cn</p>
  </AbsoluteFill>;
}

export type SceneDef = { name: string; seconds: number; component: () => ReactNode };
export const sceneList: SceneDef[] = [
  { name: "开场", seconds: 5, component: Opening },
  { name: "首页", seconds: 6.2, component: HomeStart },
  { name: "资料库", seconds: 5.8, component: DatasetsScene },
  { name: "导入简历", seconds: 6.8, component: ResumesScene },
  { name: "导入岗位", seconds: 7.6, component: JobsImportScene },
  { name: "按岗位改简历", seconds: 15, component: ChatScene },
  { name: "投递推进", seconds: 5.6, component: JobsAdvanceScene },
  { name: "一面复盘", seconds: 11, component: ReviewScene },
  { name: "二面准备", seconds: 5, component: PrepScene },
  { name: "模拟面试", seconds: 11.2, component: MockSessionScene },
  { name: "能力看板", seconds: 7, component: DashboardScene },
  { name: "回到首页", seconds: 5.6, component: HomeEnd },
  { name: "结尾", seconds: 5.5, component: Ending },
];
