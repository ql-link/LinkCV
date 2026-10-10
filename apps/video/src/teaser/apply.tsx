import { CircleAlert, Puzzle } from "lucide-react";
import type { CSSProperties } from "react";
import { AbsoluteFill, Img } from "remotion";
import mark from "@web-assets/linkresume-mark-132.png";
import { clamp01, mix } from "../app/anim";
import { font } from "../app/theme";
import { Caption, CaptionScrim, CheckDraw, bezierPts, bump, easeIO, k, pop, prog, shadow, springAt, useLocalT } from "./fx";
import { PAPER, ResumeThumb, THUMB, THUMB_ARRIVE } from "./resume";
import { tr } from "./copy";

const B = { x: 100, y: 150, w: 780, h: 660 };
const COL = (c: number) => 1000 + c * 272;
const SLOT = (s: number) => 232 + s * 76;
const CW = 256;
const CH = 64;
const THUMB_H = THUMB.w * (PAPER.h / PAPER.w);
const REQS = [tr("熟悉 Java、Spring Boot，具备良好的编码习惯"), tr("熟悉 MySQL、Redis，有高并发场景经验"), tr("有 JVM 调优和线上问题排查经验"), tr("了解 Kafka 等消息中间件"), tr("有分布式系统设计经验者优先")];
const MATCH: [boolean, string][] = [[true, "Java / Spring Boot"], [true, "MySQL / Redis"], [true, tr("高并发场景经验")], [false, tr("JVM 调优经验 · 简历未体现")]];
const DAYS = [tr("周一 13"), tr("周二 14"), tr("周三 15"), tr("周四 16"), tr("周五 17")];
const HOURS = ["10:00", "14:00", "16:00"];
const CAL = { x: 1070, dw: 146, top: 530 };
const hourY = (h: number) => CAL.top + 46 + h * 84;
/** 一面日程块，面试镜头从这里放大成录音面板。 */
export const EVENT = { x: CAL.x + 3 * CAL.dw + 6, y: hourY(1) + 6, w: CAL.dw - 12, h: 62 };

const FLY_AT = 1.25;
const MATCH_AT = 2.45;
const MATCH_OUT = 4.0;
const MOVE_AT = 3.95;
const DROP_AT = 4.7;
/** 面试镜头开始接手的时间。 */
export const APPLY_HAND = 5.4;
export const APPLY_SECONDS = 6.0;

function JobCard({ co, role, style }: { co: string; role: string; style?: CSSProperties }) {
  return <div style={{ position: "absolute", width: CW, height: CH, boxSizing: "border-box", padding: "11px 16px", borderRadius: 10, background: k.paper, boxShadow: shadow.card, fontFamily: font.sans, ...style }}>
    <div style={{ fontSize: 16, fontWeight: 600, color: k.ink }}>{co}</div>
    <div style={{ marginTop: 3, fontSize: 13.5, color: k.mute }}>{role}</div>
  </div>;
}

export function ApplyScene() {
  const t = useLocalT();
  const enter = prog(t, 0.1, 0.8, easeIO);
  const hand = 1 - prog(t, APPLY_HAND, 0.4);
  const ext = prog(t, 1.0, 0.3);
  const fly = prog(t, FLY_AT, 0.8, easeIO);
  const flyLin = clamp01((t - FLY_AT) / 0.8);
  const move = prog(t, MOVE_AT, 0.7, easeIO);
  const moved = t > MOVE_AT + 0.35;
  const ring = prog(t, MATCH_AT + 0.15, 0.8, easeIO);
  const link = prog(t, MATCH_AT - 0.25, 0.35, easeIO) * (1 - prog(t, MATCH_OUT, 0.25));
  const thumbOut = prog(t, MATCH_OUT, 0.3);

  const from = { x: B.x + B.w - 160, y: B.y + 100 };
  const to = { x: COL(0) + CW / 2, y: SLOT(0) + CH / 2 };
  const arc = bezierPts(from, { x: from.x + 120, y: from.y - 160 }, { x: to.x - 80, y: to.y - 160 }, to, 40);
  const pos = arc[Math.round(fly * 40)];
  const hero = t < MOVE_AT ? { x: pos.x - CW / 2, y: pos.y - CH / 2 } : { x: mix(COL(0), COL(1), move), y: mix(SLOT(0), SLOT(2), move) - Math.sin(Math.PI * clamp01((t - MOVE_AT) / 0.7)) * 16 };
  const counts = [t > FLY_AT + 0.7 && !moved ? 1 : 0, moved ? 3 : 2, 1];

  // 日程块落下：弹簧越过终点时轻压扁
  const dv = springAt(t, DROP_AT);
  const squash = Math.max(0, dv - 1);

  return <AbsoluteFill>
    <div style={{ position: "absolute", inset: 0, opacity: hand }}>
      {/* 招聘页与浏览器插件 */}
      <div style={{ position: "absolute", left: B.x, top: B.y, width: B.w, height: B.h, borderRadius: 14, background: k.paper, boxShadow: shadow.paper, overflow: "hidden", fontFamily: font.sans, opacity: enter * mix(1, 0.4, prog(t, MATCH_AT, 0.6)), transform: `translateX(${(1 - enter) * -90}px)` }}>
        <div style={{ height: 54, display: "flex", alignItems: "center", gap: 8, padding: "0 18px", borderBottom: `1px solid ${k.hair}` }}>
          {[0, 1, 2].map((i) => <span key={i} style={{ width: 11, height: 11, borderRadius: "50%", background: "#e4e0d8" }} />)}
          <span style={{ marginLeft: 14, flex: 1, height: 30, borderRadius: 8, background: "#f5f3ef", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 14, color: k.mute }}>jobs.example.com/positions/java-backend</span>
          <span style={{ width: 34, height: 34, borderRadius: 8, display: "grid", placeItems: "center", background: ext > 0 ? `rgba(238,242,252,${ext})` : undefined, boxShadow: ext > 0 ? `inset 0 0 0 1px rgba(63,111,216,${ext * 0.5})` : undefined, transform: `scale(${bump(t, 1.0, 0.18)})` }}><Img src={mark} style={{ width: 20, height: 20 }} /></span>
          <Puzzle size={18} color={k.subtle} strokeWidth={1.8} />
        </div>
        <div style={{ padding: "34px 44px" }}>
          <div style={{ fontSize: 14, color: k.mute, letterSpacing: "0.2em" }}>{tr("职位详情")}</div>
          <div style={{ marginTop: 10, fontFamily: font.serif, fontSize: 34, fontWeight: 600, color: k.ink }}>{tr("Java 后端开发工程师")}</div>
          <div style={{ marginTop: 10, fontSize: 17, color: k.text }}>{tr("星河科技 · 杭州 · 25–40K · 本科")}</div>
          <div style={{ marginTop: 24, height: 1, background: k.hair }} />
          <div style={{ marginTop: 22, fontSize: 17, fontWeight: 600, color: k.ink }}>{tr("岗位要求")}</div>
          {REQS.map((r, i) => <div key={r} style={{ marginTop: 12, fontSize: 16, color: k.text }}>{i + 1}. {r}</div>)}
        </div>
      </div>

      {/* 岗位看板 */}
      {[tr("待投递"), tr("一面"), tr("二面")].map((name, c) => {
        const p = prog(t, 0.3 + c * 0.08, 0.7);
        return <div key={name} style={{ opacity: p, transform: `translateY(${(1 - p) * 16}px)` }}>
          <div style={{ position: "absolute", left: COL(c), top: 172, fontFamily: font.serif, fontSize: 22, fontWeight: 600, color: k.ink }}>{name}<span style={{ display: "inline-block", marginLeft: 10, fontFamily: font.sans, fontSize: 15, fontWeight: 400, color: k.mute, transform: `scale(${bump(t, c === 0 ? FLY_AT + 0.7 : MOVE_AT + 0.35, c === 2 ? 0 : 0.3)})` }}>{counts[c]}</span></div>
          <div style={{ position: "absolute", left: COL(c), top: 212, width: CW, height: 1, background: k.hair }} />
        </div>;
      })}
      {[[tr("云栈科技"), tr("Java 开发"), 1, 0], [tr("数澜网络"), tr("后端开发"), 1, 1], [tr("北辰互娱"), tr("服务端开发"), 2, 0]].map(([co, role, c, s], i) => <JobCard key={co as string} co={co as string} role={role as string} style={{ left: COL(c as number), top: SLOT(s as number), ...pop(t, 0.45 + i * 0.08, { soft: true }) }} />)}

      {/* 简历缩略图：从简历镜头缩小停稳后接住 */}
      {t >= THUMB_ARRIVE && thumbOut < 1 && <div style={{ position: "absolute", inset: 0, opacity: 1 - thumbOut }}>
        <ResumeThumb />
        <div style={{ position: "absolute", left: THUMB.x, top: THUMB.y + THUMB_H + 12, width: THUMB.w, textAlign: "center", fontFamily: font.sans, fontSize: 14, color: k.text, ...pop(t, THUMB_ARRIVE + 0.1, { soft: true, dy: -6 }) }}>{tr("我的简历")}</div>
      </div>}
      {link > 0 && <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: link }}>
        <path d={`M${COL(0) + 60} ${SLOT(0) + CH} C ${COL(0) + 60} ${SLOT(0) + CH + 110}, ${THUMB.x + THUMB.w / 2} ${THUMB.y - 120}, ${THUMB.x + THUMB.w / 2} ${THUMB.y}`} pathLength={1} strokeDasharray={`${link} 1`} stroke={k.blue} strokeWidth={1.4} fill="none" />
      </svg>}

      {/* 匹配度：从简历缩略图旁长出 */}
      <div style={{ position: "absolute", left: 1190, top: 548, width: 620, height: 210, boxSizing: "border-box", padding: "22px 28px", borderRadius: 14, background: k.paper, boxShadow: shadow.card, fontFamily: font.sans, ...pop(t, MATCH_AT, { out: MATCH_OUT, dx: -24, dy: 0, origin: "0 50%" }) }}>
        <div style={{ fontSize: 14, color: k.mute, letterSpacing: "0.12em" }}>{tr("岗位匹配度 · 星河科技")}</div>
        <svg width={130} height={130} style={{ position: "absolute", left: 24, top: 56 }}>
          <circle cx={65} cy={65} r={54} stroke={k.hair} strokeWidth={5} fill="none" />
          <circle cx={65} cy={65} r={54} stroke={k.blue} strokeWidth={5} fill="none" strokeLinecap="round" pathLength={1} strokeDasharray={`${0.86 * ring} 1`} transform="rotate(-90 65 65)" />
        </svg>
        <div style={{ position: "absolute", left: 24, top: 104, width: 130, textAlign: "center", fontSize: 28, fontWeight: 600, color: k.ink, fontVariantNumeric: "tabular-nums", transform: `scale(${bump(t, MATCH_AT + 0.95)})` }}>{Math.round(86 * ring)}%</div>
        {MATCH.map(([ok, text], j) => {
          const at = MATCH_AT + 0.3 + j * 0.1;
          return <div key={text} style={{ position: "absolute", left: 190, top: 54 + j * 36, display: "flex", alignItems: "center", gap: 10, fontSize: 17, color: ok ? k.text : k.ink, ...pop(t, at, { soft: true, dx: 12, dy: 0, from: 0.96, origin: "0 50%" }) }}>
            {ok ? <CheckDraw p={prog(t, at + 0.1, 0.3)} size={17} /> : <CircleAlert size={17} color={k.orange} strokeWidth={2} />}{text}
          </div>;
        })}
      </div>

      {/* 面试日程 */}
      <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, fontFamily: font.sans, ...pop(t, MOVE_AT + 0.3, { soft: true, dy: 20, from: 0.97, origin: "1400px 530px" }) }}>
        <div style={{ position: "absolute", left: 1000, top: CAL.top - 34, fontSize: 15, color: k.mute, letterSpacing: "0.12em", whiteSpace: "nowrap" }}>{tr("面试日程 · 本周")}</div>
        {DAYS.map((d, i) => <div key={d} style={{ position: "absolute", left: CAL.x + i * CAL.dw, top: CAL.top, width: CAL.dw, textAlign: "center", fontSize: 15, color: i === 3 ? k.ink : k.mute, fontWeight: i === 3 ? 600 : 400 }}>{d}</div>)}
        {HOURS.map((h, i) => <div key={h}>
          <div style={{ position: "absolute", left: 1000, top: hourY(i) - 10, fontSize: 13, color: k.subtle }}>{h}</div>
          <div style={{ position: "absolute", left: CAL.x, top: hourY(i), width: CAL.dw * 5, height: 1, background: k.hair }} />
        </div>)}
        {DAYS.map((_, i) => i > 0 && <div key={i} style={{ position: "absolute", left: CAL.x + i * CAL.dw, top: CAL.top + 32, width: 1, height: 270, background: k.hair }} />)}
        <div style={{ position: "absolute", left: CAL.x + CAL.dw + 6, top: hourY(0) + 6, width: CAL.dw - 12, height: 62, boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, boxShadow: `inset 0 0 0 1px ${k.border}`, background: k.paper }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: k.ink }}>{tr("二面 · 北辰互娱")}</div><div style={{ fontSize: 12.5, color: k.mute, marginTop: 2 }}>10:00 – 11:00</div>
        </div>
      </div>
      {fly > 0 && <JobCard co={tr("星河科技")} role={tr("Java 后端开发")} style={{ left: hero.x, top: hero.y, zIndex: 3, boxShadow: flyLin < 1 || (t > MOVE_AT && t < MOVE_AT + 0.7) ? shadow.lift : shadow.card, transform: `scale(${mix(0.85, 1, fly) * (flyLin < 1 ? 1 : bump(t, FLY_AT + 0.8, 0.05))})` }} />}
    </div>

    {/* 一面日程块不随交接淡出：面试镜头接手的同一帧隐藏，由面试镜头的同款卡片原位放大 */}
    {dv > 0 && t < APPLY_HAND && <div style={{ position: "absolute", left: EVENT.x, top: EVENT.y - (1 - Math.min(dv, 1)) * 60, width: EVENT.w, height: EVENT.h, boxSizing: "border-box", padding: "8px 10px 8px 13px", borderRadius: 8, background: k.blueSoft, overflow: "hidden", fontFamily: font.sans, opacity: clamp01((t - DROP_AT) / 0.15), boxShadow: dv < 0.98 ? shadow.lift : undefined, transformOrigin: "50% 100%", transform: `scale(${1 + squash * 1.2}, ${1 - squash * 2.5})` }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: k.blue }} />
      <div style={{ fontSize: 13.5, fontWeight: 600, color: k.ink }}>{tr("一面 · 星河科技")}</div><div style={{ fontSize: 12.5, color: k.text, marginTop: 2 }}>14:00 – 15:00</div>
    </div>}

    <CaptionScrim opacity={hand} />
    <Caption text={tr("从收藏到面试，一路跟进")} t={t} at={0.5} out={5.1} />
  </AbsoluteFill>;
}
