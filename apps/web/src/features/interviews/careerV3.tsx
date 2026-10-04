import { t, useLocale } from "@/i18n";
// 求职中心（岗位看板 / 面试日程 / 岗位详情）在 V3 设计里共用的小件：浮动提示、页头、插图。
// 公共 Token 与基础件来自 src/v3，这里只放本模块的组合。
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type V3IconName } from "@/v3/Icon";
import { Badge, Bar, Centered, DashArrow, Paper, StageText } from "@/v3/art";
import { PageEyebrow, type EyebrowSegment } from "@/v3/primitives";

/* ───────────── 浮动提示（设计稿 04.1 状态变体③ / 10.3 冲突：白底描边，橙色感叹号） ───────────── */

export function CareerNotice({
  title,
  message,
  kind = "error",
  className = "",
  onDismiss,
  action,
}: {
  title?: string;
  message: ReactNode;
  kind?: "error" | "success";
  className?: string;
  onDismiss: () => void;
  action?: ReactNode;
}) {
  useLocale();
  // 3 秒后自动消失，和旧的 FeedbackNotice 行为一致（没有关闭按钮）
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);
  return createPortal(
    <div className={`v3 career-notice is-${kind} ${className}`} role={kind === "error" ? "alert" : "status"}>
      <span className="career-notice-mark" aria-hidden="true">{kind === "error" ? "!" : <Icon name="check" size={10} strokeWidth={2.4} />}</span>
      <div className="career-notice-copy">
        {title ? <strong>{title}</strong> : null}
        {title ? <small>{message}</small> : <strong>{message}</strong>}
      </div>
      {action}
    </div>,
    document.body,
  );
}

/* ───────────── 页头：日期小字 + 衬线大标题 + 副标题 + 右侧按钮组 ───────────── */

export function CareerPageHead({
  eyebrow,
  title,
  subtitle,
  actions,
  className = "",
}: {
  eyebrow: ReactNode | EyebrowSegment[];
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  useLocale();
  return (
    <header className={`career-v3-head ${className}`}>
      <div className="career-v3-head-copy">
        <PageEyebrow segments={Array.isArray(eyebrow) ? eyebrow : [eyebrow]} />
        <h1 className="v3-page-title">{title}</h1>
        {subtitle ? <p className="v3-page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="career-v3-head-actions">{actions}</div> : null}
    </header>
  );
}

/* ───────────── 日程详情弹窗插图（设计稿脚本 p07e.js，舞台 456×128） ───────────── */

type TileColor = "blue" | "orange" | "green" | "purple" | "gray";
const TILE_COLORS: Record<TileColor, string> = {
  blue: "var(--v3-bl)",
  orange: "var(--v3-or)",
  green: "var(--v3-gn)",
  purple: "var(--v3-purple)",
  gray: "var(--v3-fnt)",
};

// 日期卡：顶部色条写月份，中间大号日期，底部一行小字
function DateTile({ x, y, color, month, day, sub, dim = false }: { x: number; y: number; color: TileColor; month: string; day: string; sub: string; dim?: boolean }) {
  useLocale();
  return (
    <Paper x={x} y={y} w={72} h={82} r={10} style={{ opacity: dim ? 0.5 : 1, boxShadow: "0 4px 12px rgb(0 0 0 / 8%)" }}>
      <span style={{ position: "absolute", inset: "0 0 auto", height: 20, background: TILE_COLORS[color], color: "#fff", fontSize: 9.5, fontWeight: 500, lineHeight: "20px", textAlign: "center" }}>{month}</span>
      <span style={{ position: "absolute", top: 24, left: 0, right: 0, fontFamily: "var(--v3-num)", fontSize: 26, fontWeight: 600, textAlign: "center", color: "var(--v3-txt)", lineHeight: "32px" }}>{day}</span>
      <span style={{ position: "absolute", top: 62, left: 0, right: 0, fontFamily: "var(--v3-num)", fontSize: 9.5, fontWeight: 500, textAlign: "center", color: "var(--v3-fnt)" }}>{sub}</span>
    </Paper>
  );
}

function ArtCard({ x, y, w = 168, h = 88, background, children }: { x: number; y: number; w?: number; h?: number; background?: string; children?: ReactNode }) {
  useLocale();
  return <Paper x={x} y={y} w={w} h={h} r={10} style={{ background: background ?? "#fff", boxShadow: "0 4px 12px rgb(0 0 0 / 6%)" }}>{children}</Paper>;
}

export type ScheduleArtKind = "video" | "onsite" | "exam" | "window" | "test" | "ai" | "done" | "cancel";

export type ScheduleArtDate = { month: string; day: string; sub: string };

// 每类安排一张插图：视频通话 / 地图定位 / 试卷 / 官方时段时间轴 / 测评量表 / AI 语音波形 / 结果 / 划掉的日期
export function ScheduleArt({ kind, date, windowInfo }: { kind: ScheduleArtKind; date: ScheduleArtDate; windowInfo?: { open: string; close: string; remain: string; todayRatio: number; planRatio: number | null } }) {
  useLocale();
  return (
    <Centered width={456} height={128}>
      {kind === "video" && (
        <>
          <DateTile x={96} y={23} color="blue" {...date} />
          <ArtCard x={192} y={20}>
            {[0, 1, 2].map((i) => <span key={i} style={{ position: "absolute", left: 10 + i * 9, top: 9, width: 5, height: 5, borderRadius: 3, background: "var(--v3-fl)" }} />)}
            {[[t("张"), 10, false], [t("我"), 88, true]].map(([name, left, dark]) => (
              <span key={String(name)} style={{ position: "absolute", left: Number(left), top: 22, width: 70, height: 44, borderRadius: 6, background: "var(--v3-field)" }}>
                <span style={{ position: "absolute", left: 23, top: 8, display: "grid", width: 24, height: 24, placeItems: "center", borderRadius: 12, background: dark ? "var(--v3-dark)" : "var(--v3-sk2)", color: dark ? "#fff" : "var(--v3-sub)", fontSize: 10, fontWeight: 500 }}>{name}</span>
              </span>
            ))}
            <span style={{ position: "absolute", left: 54, top: 72, width: 60, height: 10, borderRadius: 5, background: "var(--v3-field)" }}>
              <span style={{ position: "absolute", left: 8, top: 2, width: 6, height: 6, borderRadius: 3, background: "var(--v3-sk2)" }} />
              <span style={{ position: "absolute", left: 20, top: 2, width: 6, height: 6, borderRadius: 3, background: "var(--v3-sk2)" }} />
              <span style={{ position: "absolute", left: 34, top: 2, width: 18, height: 6, borderRadius: 3, background: "var(--v3-rd)" }} />
            </span>
          </ArtCard>
        </>
      )}
      {kind === "onsite" && (
        <>
          <DateTile x={96} y={23} color="orange" {...date} />
          <ArtCard x={192} y={20} background="#f1f2ee">
            <Bar x={0} y={34} w={168} h={7} color="#fff" r={0} />
            <Bar x={0} y={66} w={168} h={5} color="#fff" r={0} />
            <Bar x={58} y={0} w={7} h={88} color="#fff" r={0} />
            <Bar x={118} y={0} w={5} h={88} color="#fff" r={0} />
            <Bar x={72} y={8} w={38} h={20} color="#e4e8df" r={4} />
            <Bar x={10} y={46} w={40} h={14} color="#e4e8df" r={4} />
            <Bar x={128} y={46} w={32} h={30} color="#e4e8df" r={4} />
            <Badge x={80} y={30} icon="pin" />
          </ArtCard>
        </>
      )}
      {kind === "exam" && (
        <>
          <DateTile x={96} y={23} color="purple" {...date} />
          <ArtCard x={192} y={20}>
            <Bar x={14} y={12} w={56} h={6} color="var(--v3-dark)" r={2} />
            <Bar x={14} y={22} w={86} h={4} color="var(--v3-sk2)" r={2} />
            {[0, 1, 2].map((i) => (
              <span key={i}>
                <span style={{ position: "absolute", left: 14, top: 38 + i * 16, display: "grid", width: 10, height: 10, placeItems: "center", border: i === 0 ? 0 : "1px solid var(--v3-fl)", borderRadius: 3, background: i === 0 ? "var(--v3-dark)" : "#fff", color: "#fff" }}>{i === 0 ? <Icon name="check" size={8} strokeWidth={2.4} /> : null}</span>
                <Bar x={30} y={41 + i * 16} w={i === 1 ? 92 : 112} h={4} r={2} />
              </span>
            ))}
            <Badge x={136} y={10} icon="clock" fill="#fff" color="var(--v3-sub)" border="var(--v3-cl)" />
          </ArtCard>
        </>
      )}
      {kind === "window" && windowInfo && (
        <ArtCard x={48} y={24} w={360} h={80}>
          <StageText x={20} y={12} color="var(--v3-fnt)">{t("官方时段")}</StageText>
          <StageText x={260} y={12} color="var(--v3-or)" style={{ width: 80, textAlign: "right" }}>{windowInfo.remain}</StageText>
          <Bar x={20} y={40} w={320} h={6} color="var(--v3-sk2)" r={3} />
          <Bar x={20} y={40} w={Math.round(320 * windowInfo.todayRatio)} h={6} color="var(--v3-fl)" r={3} />
          {windowInfo.planRatio !== null && <Bar x={20 + Math.round(320 * windowInfo.planRatio)} y={37} w={12} h={12} color="var(--v3-bl)" r={4} />}
          <Bar x={20 + Math.round(320 * windowInfo.todayRatio)} y={35} w={1.5} h={16} color="var(--v3-or)" r={1} />
          <StageText x={20} y={56} size={9.5} color="var(--v3-fnt)" weight={400} num>{windowInfo.open}</StageText>
          <StageText x={260} y={56} size={9.5} color="var(--v3-fnt)" weight={400} num style={{ width: 80, textAlign: "right" }}>{windowInfo.close}</StageText>
          <StageText x={20 + Math.round(320 * windowInfo.todayRatio) - 10} y={56} size={9.5} color="var(--v3-or)">{t("今天")}</StageText>
          {windowInfo.planRatio !== null && <StageText x={20 + Math.round(320 * windowInfo.planRatio) - 14} y={20} size={9.5} color="var(--v3-bl)">{t("我的计划")}</StageText>}
        </ArtCard>
      )}
      {kind === "test" && (
        <>
          <DateTile x={96} y={23} color="orange" {...date} />
          <ArtCard x={192} y={20}>
            <Bar x={14} y={14} w={108} h={5} color="var(--v3-dark)" r={2} />
            <Bar x={14} y={24} w={72} h={4} color="var(--v3-sk2)" r={2} />
            {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ position: "absolute", left: 18 + i * 30, top: 44, width: 14, height: 14, borderRadius: 7, border: i === 3 ? 0 : "1.2px solid var(--v3-fl)", background: i === 3 ? "var(--v3-dark)" : "#fff" }} />)}
            <StageText x={14} y={66} size={8.5} color="var(--v3-fnt)" weight={400}>{t("不符合")}</StageText>
            <StageText x={124} y={66} size={8.5} color="var(--v3-fnt)" weight={400}>{t("很符合")}</StageText>
          </ArtCard>
        </>
      )}
      {kind === "ai" && (
        <>
          <DateTile x={96} y={23} color="blue" {...date} />
          <ArtCard x={192} y={20}>
            <span style={{ position: "absolute", left: 14, top: 16, display: "grid", width: 36, height: 36, placeItems: "center", borderRadius: 18, background: "var(--v3-dark)", color: "#fff" }}><Icon name="spark" size={16} /></span>
            {[6, 12, 20, 14, 24, 10, 18, 8, 14, 22, 12, 6].map((h, i) => <Bar key={i} x={62 + i * 8} y={34 - h / 2} w={4} h={h} color={i < 7 ? "var(--v3-dark)" : "var(--v3-sk2)"} r={2} />)}
            <Bar x={14} y={64} w={120} h={4} r={2} />
            <Bar x={14} y={74} w={84} h={4} r={2} />
          </ArtCard>
        </>
      )}
      {kind === "done" && (
        <>
          <DateTile x={96} y={23} color="orange" {...date} />
          <Badge x={158} y={17} icon="check" fill="var(--v3-gn)" />
          <ArtCard x={210} y={34} w={150} h={60}>
            <StageText x={14} y={12} color="var(--v3-fnt)">{t("本轮结果")}</StageText>
            <span style={{ position: "absolute", left: 14, top: 30, display: "grid", width: 56, height: 20, placeItems: "center", borderRadius: 10, background: "var(--v3-gn-soft)", color: "var(--v3-gn)", fontSize: 10, fontWeight: 500 }}>{t("已完成")}</span>
            <Bar x={80} y={38} w={54} h={4} r={2} />
          </ArtCard>
        </>
      )}
      {kind === "cancel" && (
        <>
          <DateTile x={192} y={23} color="gray" dim {...date} />
          <Bar x={188} y={63} w={80} h={1.5} color="var(--v3-fnt)" r={1} />
          <Badge x={252} y={17} icon="minus" fill="#fff" color="var(--v3-fnt)" border="var(--v3-cl)" />
        </>
      )}
    </Centered>
  );
}

/* ───────────── 通用插图：一张卡片 + 箭头 + 目标（导入 / 插件 / 空状态复用） ───────────── */

export function ArrowArt({ x, y, w }: { x: number; y: number; w: number }) {
  useLocale();
  return <DashArrow x={x} y={y} w={w} />;
}

export function StageCaption({ title, body }: { title: string; body: string }) {
  useLocale();
  return (
    <span className="career-stage-caption" aria-hidden="true">
      <strong>{title}</strong>
      <small>{body}</small>
    </span>
  );
}

export function IconBadge({ icon, dark = true }: { icon: V3IconName; dark?: boolean }) {
  useLocale();
  return <span className={`career-icon-badge${dark ? " is-dark" : ""}`} aria-hidden="true"><Icon name={icon} size={12} /></span>;
}
