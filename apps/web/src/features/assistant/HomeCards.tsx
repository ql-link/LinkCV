import { getLocale, t, useLocale, weekdayName, weekdays } from "@/i18n";
import type { ReactNode } from "react";
import { careerApplicationPath, careerViewPath, editorPath, navigateTo } from "../../routing";
import { Icon } from "../../v3/Icon";
import { Bar, Dot, Paper, StageText } from "../../v3/art";
import { BeTag } from "../../v3/primitives";
import { MOCK_HOME_OFFER_COMPARE, MOCK_HOME_RECOMMENDED_JOB_ROWS, MOCK_OFFER, MOCK_RECOMMENDED_JOBS } from "../../v3/mocks";
import { pipelineColumns, startOfWeek, type HomeCard } from "./homeDashboard";

// 首页三张 227×236 卡片：上方 211×112 插图舞台（点阵底），下方衬线标题 + 说明 + 文字按钮。
// 插图坐标全部取自 Figma「01.1 首页」「01.1 首页 · 状态变体」。

function formatClock(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function CardFrame({
  stage,
  title,
  sub,
  action,
  href,
  beTitle,
  beSub,
  label,
}: {
  stage: ReactNode;
  title: ReactNode;
  sub: ReactNode;
  action: string;
  href: string;
  beTitle?: boolean;
  beSub?: boolean;
  label: string;
}) {
  useLocale();
  return (
    <a
      className="assistant-home-card"
      href={href}
      aria-label={label}
      onClick={(event) => {
        if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        navigateTo(href);
      }}
    >
      <span className="v3-stage has-dots assistant-home-stage" aria-hidden="true">{stage}</span>
      <strong className="assistant-home-card-title"><span>{title}</span>{beTitle && <BeTag />}</strong>
      <span className="assistant-home-card-sub">{sub}{beSub && <BeTag />}</span>
      <span className="assistant-home-card-action">{action}<Icon name="arrow" size={12} /></span>
    </a>
  );
}

/* ── 各卡片的插图 ── */

function FirstResumeArt() {
  useLocale();
  return (
    <>
      <Paper x={68} y={8} w={74} h={96} r={4}>
        <Bar x={9} y={10} w={28} h={5} color="var(--v3-dark)" />
        {[26, 50, 74].map((y) => (
          <span key={y} style={{ position: "absolute", left: 9, top: y, width: 56, height: 16, border: "1px dashed var(--v3-fl)", borderRadius: 3 }} />
        ))}
      </Paper>
      {[
        { x: 22, y: 26, r: -4, t: t("教育") },
        { x: 150, y: 52, r: 3, t: t("项目") },
        { x: 28, y: 76, r: 2, t: t("技能") },
      ].map((item) => (
        <span key={item.t} className="assistant-home-module" style={{ left: item.x, top: item.y, transform: `rotate(${item.r}deg)` }}>{item.t}</span>
      ))}
    </>
  );
}

function TargetArt() {
  useLocale();
  const row = (items: Array<[number, string, boolean]>, y: number) => items.map(([x, text, strong]) => (
    <span key={text} className={`assistant-home-tag${strong ? " is-strong" : ""}`} style={{ left: x, top: y }}>{text}</span>
  ));
  return (
    <>
      {row([[16, t("后端开发"), true], [78, "Java", true], [123, t("基础架构"), true]], 22)}
      {row([[16, t("北京"), false], [58, t("2026 校招"), false]], 52)}
    </>
  );
}

function PluginArt() {
  useLocale();
  return (
    <Paper x={18} y={14} w={175} h={86} r={6} shadow={false}>
      <Bar x={0} y={0} w={175} h={14} color="var(--v3-field)" r={0} />
      {[7, 15, 23].map((x) => <Dot key={x} x={x} y={5} size={5} color="var(--v3-sk2)" />)}
      <Bar x={10} y={24} w={60} h={5} color="var(--v3-dark)" />
      <Bar x={10} y={34} w={90} h={3} color="var(--v3-sk2)" />
      <Bar x={10} y={46} w={110} h={3} />
      <Bar x={10} y={54} w={110} h={3} />
      <Bar x={10} y={62} w={70} h={3} />
      <span style={{ position: "absolute", left: 89, top: 60, display: "grid", width: 76, height: 20, placeItems: "center", borderRadius: 5, background: "var(--v3-gn-soft)", color: "var(--v3-gn)", fontSize: 10, fontWeight: 500 }}>{t("收藏到简历")}</span>
    </Paper>
  );
}

function TodayArt({ start, end, title, mode }: { start: Date; end: Date; title: string; mode: string }) {
  useLocale();
  const hour = start.getHours();
  const slots = [hour - 1, hour, hour + 1];
  const top = 22 + ((start.getMinutes() / 60) * 32) + 32;
  const height = Math.max(20, Math.min(40, ((end.getTime() - start.getTime()) / 3_600_000) * 32 - 1));
  return (
    <>
      {slots.map((value, index) => (
        <span key={value}>
          <StageText x={14} y={16 + index * 32} size={9} color="var(--v3-fnt)" num>{`${String((value + 24) % 24).padStart(2, "0")}:00`}</StageText>
          <Bar x={50} y={22 + index * 32} w={147} h={1} color="var(--v3-hl)" r={0} />
        </span>
      ))}
      <span style={{ position: "absolute", left: 56, top: top + 1, width: 141, height, overflow: "hidden", borderRadius: 5, background: "#e4ebfa" }}>
        <Bar x={0} y={0} w={3} h={height} color="var(--v3-bl)" r={0} />
        <StageText x={10} y={4} size={10.5} color="var(--v3-bl)">{title}</StageText>
        {height >= 28 && <StageText x={10} y={18} size={9}>{mode}</StageText>}
      </span>
      <Bar x={50} y={33} w={147} h={2} color="var(--v3-rd)" r={0} />
      <Dot x={46} y={30} size={7} color="var(--v3-rd)" />
    </>
  );
}

function ResumeArt({ missing }: { missing: string | null }) {
  useLocale();
  return (
    <>
      <Paper x={26} y={10} w={78} h={96} r={4}>
        <Bar x={8} y={9} w={34} h={5} color="var(--v3-dark)" />
        <Bar x={8} y={18} w={50} h={3} color="var(--v3-sk2)" />
        <Bar x={8} y={30} w={16} h={3} color="var(--v3-sub)" />
        <Bar x={8} y={37} w={60} h={3} />
        <Bar x={8} y={43} w={60} h={3} />
        <Bar x={8} y={49} w={40} h={3} />
        <Bar x={8} y={58} w={16} h={3} color="var(--v3-sub)" />
        <Bar x={8} y={65} w={60} h={3} />
        <Bar x={8} y={71} w={40} h={3} />
        {missing && <span style={{ position: "absolute", left: 8, top: 80, width: 62, height: 10, border: "1px dashed var(--v3-or)", borderRadius: 2, background: "#fdf6ee" }} />}
      </Paper>
      {missing && (
        <>
          <Bar x={104} y={95} w={8} h={1} color="var(--v3-or)" r={0} />
          <span className="assistant-home-flag" style={{ left: 112, top: 86 }}>{t("待补 · ")}{missing}</span>
        </>
      )}
    </>
  );
}

function PipelineArt({ columns }: { columns: ReturnType<typeof pipelineColumns> }) {
  useLocale();
  const items: Array<{ x: number; label: string; color: string; count: number; accent?: boolean }> = [
    { x: 12, label: t("待投递"), color: "var(--v3-fnt)", count: columns.pending },
    { x: 60, label: t("笔试"), color: "var(--v3-or)", count: columns.test },
    { x: 108, label: t("面试"), color: "var(--v3-bl)", count: columns.interview },
    { x: 157, label: "Offer", color: "var(--v3-gn)", count: columns.offer, accent: true },
  ];
  return (
    <>
      {items.map((item) => (
        <span key={item.label}>
          <Dot x={item.x} y={17} size={5} color={item.color} />
          <StageText x={item.x + 8} y={13} size={9}>{item.label}</StageText>
          {Array.from({ length: Math.min(3, item.count) }, (_, index) => (
            <span key={index} style={{ position: "absolute", left: item.x, top: 30 + index * 20, width: 42, height: 15, overflow: "hidden", border: "1px solid var(--v3-cl)", borderRadius: 3, background: "#fff" }}>
              {item.accent && <Bar x={0} y={0} w={2} h={15} color="var(--v3-gn)" />}
            </span>
          ))}
        </span>
      ))}
    </>
  );
}

function WeekArt({ now, sessionDays }: { now: Date; sessionDays: Set<number> }) {
  useLocale();
  const monday = startOfWeek(now);
  const names = [t("一"), t("二"), t("三"), t("四"), t("五"), t("六"), t("日")];
  return (
    <>
      {names.map((name, index) => {
        const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
        const x = 13 + index * 26.8;
        const today = day.toDateString() === now.toDateString();
        return (
          <span key={name}>
            <StageText x={x + 8} y={22} size={9} color="var(--v3-fnt)" weight={400}>{name}</StageText>
            {today && <span style={{ position: "absolute", left: x, top: 40, width: 24, height: 24, border: "1px solid var(--v3-dark)", borderRadius: 12 }} />}
            <StageText x={x} y={45} size={11} color="var(--v3-txt)" num style={{ width: 24, textAlign: "center" }}>{day.getDate()}</StageText>
            {sessionDays.has(index) && <Dot x={x + 9.5} y={74} size={5} color="var(--v3-bl)" />}
          </span>
        );
      })}
    </>
  );
}

function JobsArt() {
  useLocale();
  return (
    <>
      {MOCK_HOME_RECOMMENDED_JOB_ROWS.map((row, index) => (
        <span key={row.title} style={{ position: "absolute", left: 12, top: 14 + index * 30, display: "flex", width: 187, height: 24, alignItems: "center", justifyContent: "space-between", border: "1px solid var(--v3-cl)", borderRadius: 5, background: "#fff", padding: "0 10px", fontSize: 10, fontWeight: 500 }}>
          <span style={{ color: "var(--v3-sub)" }}>{row.title}</span>
          <span style={{ color: "var(--v3-gn)", fontFamily: "var(--v3-num)", fontWeight: 600 }}>{row.match}%</span>
        </span>
      ))}
    </>
  );
}

function OfferArt({ deadline }: { deadline: Date }) {
  useLocale();
  const weekday = weekdays()[deadline.getDay()];
  return (
    <>
      <Paper x={47} y={14} w={64} h={84} r={8} shadow={false}>
        <span style={{ position: "absolute", inset: "0 0 auto", display: "grid", height: 20, placeItems: "center", background: "#fbeaea", color: "var(--v3-rd)", fontSize: 9, fontWeight: 500 }}>
          {new Intl.DateTimeFormat("zh-CN", { month: "long" }).format(deadline)}
        </span>
        <StageText x={0} y={26} size={28} color="var(--v3-txt)" weight={600} num style={{ width: 62, textAlign: "center" }}>{deadline.getDate()}</StageText>
        <StageText x={0} y={64} size={8.5} color="var(--v3-fnt)" style={{ width: 62, textAlign: "center" }}>{`${weekday} ${formatClock(deadline.toISOString())}`}</StageText>
      </Paper>
      <span className="assistant-home-flag" style={{ left: 123, top: 46 }}>{t("还剩 ")}{MOCK_OFFER.daysLeft}{t(" 天")}</span>
    </>
  );
}

function CompareArt() {
  useLocale();
  return (
    <>
      {MOCK_HOME_OFFER_COMPARE.map((offer, index) => (
        <Paper key={offer.company} x={12 + index * 99} y={14} w={87} h={84} r={8} shadow={false}>
          <Bar x={0} y={0} w={3} h={84} color={index === 0 ? "var(--v3-gn)" : "var(--v3-bl)"} r={0} />
          <StageText x={12} y={10} size={10}>{offer.company}</StageText>
          <StageText x={12} y={28} size={13} color="var(--v3-txt)" weight={600} num>{offer.salary}</StageText>
          <Bar x={12} y={56} w={63} h={3} />
          <Bar x={12} y={64} w={38} h={3} />
        </Paper>
      ))}
    </>
  );
}

/* ── 卡片 ── */

export function HomeCardView({ card, now }: { card: HomeCard; now: Date }) {
  useLocale();
  switch (card.kind) {
    case "firstResume":
      return <CardFrame label={t("新建第一份简历")} stage={<FirstResumeArt />} title={t("新建第一份简历")} sub={t("选模板新建，或导入已有文件")} action={t("新建简历")} href="/resumes/new" />;
    case "target":
      return <CardFrame label={t("设置求职方向")} stage={<TargetArt />} title={t("设置求职方向")} sub={t("用来推荐岗位和优化简历")} action={t("去设置")} href="/account" />;
    case "plugin":
      // 岗位看板的插件弹窗没有路由参数可以直接打开，这里只导航到看板
      return <CardFrame label={t("安装浏览器插件")} stage={<PluginArt />} title={t("安装浏览器插件")} sub={t("在招聘网站一键收藏岗位")} action={t("安装插件")} href="/career/applications" />;
    case "today": {
      const start = new Date(card.session.start_at);
      const title = `${card.session.company_name}${card.session.stage_label}`;
      const mode = { video: t("视频"), onsite: t("现场"), phone: t("电话"), other: t("其他") }[card.session.mode];
      return (
        <CardFrame
          label={t("查看今日日程")}
          stage={<TodayArt start={start} end={new Date(card.session.end_at)} title={title} mode={`${mode} · ${formatClock(card.session.start_at)}–${formatClock(card.session.end_at)}`} />}
          title={`${formatClock(card.session.start_at)} ${title}`}
          sub={card.others > 0 ? t("另有 {value0} 场安排", { value0: card.others }) : t("今天只有这一场")}
          action={t("查看日程")}
          href={careerViewPath("schedule")}
        />
      );
    }
    case "deadline":
      // 「截止提醒」卡 Figma 还没画，按规则说明参照「Offer 待回复」的样式
      return (
        <CardFrame
          label={t("查看截止提醒")}
          stage={<OfferArtForDate date={new Date(card.session.answer_plan_end_at ?? card.session.end_at)} daysLeft={card.daysLeft} />}
          title={`${card.session.company_name} · ${card.daysLeft === 0 ? t("今天截止") : t("{value0} 天后截止", { value0: card.daysLeft })}`}
          sub={t("{value0} · {value1} 前完成", { value0: card.session.stage_label, value1: formatClock(card.session.answer_plan_end_at ?? card.session.end_at) })}
          action={t("查看日程")}
          href={careerViewPath("schedule")}
        />
      );
    case "week": {
      const monday = startOfWeek(now).getTime();
      const days = new Set(card.sessions.map((session) => Math.floor((new Date(session.start_at).getTime() - monday) / 86_400_000)));
      const weekdays = [...days].sort().map((day) => ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day]).filter(Boolean);
      return (
        <CardFrame
          label={t("查看本周日程")}
          stage={<WeekArt now={now} sessionDays={days} />}
          title={card.sessions.length > 0 ? t("本周 {value0} 场面试", { value0: card.sessions.length }) : t("本周还没有面试")}
          sub={card.sessions.length > 0 ? t("{value0}各有安排", { value0: weekdays.map((label) => t(label)).join(getLocale() === "en-US" ? ", " : "、") }) : t("可以先投几个新岗位")}
          action={t("查看日程")}
          href={careerViewPath("schedule")}
        />
      );
    }
    case "resumeTodo":
      return <CardFrame label={t("继续编辑简历")} stage={<ResumeArt missing={card.missing} />} title={`${card.resume.title} · ${card.score}%`} sub={t("待完善：{value0}", { value0: card.missing })} action={t("继续编辑")} href={editorPath(card.resume.id)} />;
    case "resumeRecent":
      // 「最近编辑的简历」卡 Figma 还没画，参照「简历待完善」样式，去掉待补标记
      return <CardFrame label={t("继续编辑简历")} stage={<ResumeArt missing={null} />} title={card.score !== null ? `${card.resume.title} · ${card.score}%` : card.resume.title} sub={t("最近编辑的简历")} action={t("继续编辑")} href={editorPath(card.resume.id)} />;
    case "pipeline": {
      const columns = pipelineColumns(card.applications);
      return <CardFrame label={t("打开岗位看板")} stage={<PipelineArt columns={columns} />} title={t("{value0} 个岗位进行中", { value0: card.applications.length })} sub={card.hint} action={t("岗位看板")} href="/career/applications" />;
    }
    case "jobs":
      return <CardFrame label={t("查看推荐岗位")} stage={<JobsArt />} title={t("{value0} 个新岗位匹配", { value0: MOCK_RECOMMENDED_JOBS.count })} beTitle sub={t("最高匹配度 {value0}%", { value0: MOCK_RECOMMENDED_JOBS.bestMatch })} action={t("查看岗位")} href="/career/applications" />;
    case "offer":
      // Offer 回复截止没有后端字段，日期与剩余天数用示例数据
      return (
        <CardFrame
          label={t("查看 Offer")}
          stage={<OfferArt deadline={mockOfferDeadline(now)} />}
          title={t("{value0} · {value1} 天后截止", { value0: card.company, value1: MOCK_OFFER.daysLeft })}
          sub={MOCK_OFFER.deadlineLabel}
          beSub
          action={t("查看 Offer")}
          href={careerApplicationPath(card.applicationId)}
        />
      );
    case "compare":
      return (
        <CardFrame
          label={t("开始对比 Offer")}
          stage={<CompareArt />}
          title={t("{value0} 个 Offer 可对比", { value0: card.offers.length })}
          beTitle
          sub={t("{value0}，薪资接近", { value0: card.offers.map((offer) => offer.company_name_snapshot).join(t("和")) })}
          action={t("开始对比")}
          href="/career/applications"
        />
      );
    default:
      return null;
  }
}

function mockOfferDeadline(now: Date) {
  const date = new Date(now);
  date.setDate(date.getDate() + MOCK_OFFER.daysLeft);
  date.setHours(18, 0, 0, 0);
  return date;
}

function OfferArtForDate({ date, daysLeft }: { date: Date; daysLeft: number }) {
  useLocale();
  const weekday = weekdays()[date.getDay()];
  return (
    <>
      <Paper x={47} y={14} w={64} h={84} r={8} shadow={false}>
        <span style={{ position: "absolute", inset: "0 0 auto", display: "grid", height: 20, placeItems: "center", background: "var(--v3-or-soft)", color: "var(--v3-or)", fontSize: 9, fontWeight: 500 }}>
          {new Intl.DateTimeFormat("zh-CN", { month: "long" }).format(date)}
        </span>
        <StageText x={0} y={26} size={28} color="var(--v3-txt)" weight={600} num style={{ width: 62, textAlign: "center" }}>{date.getDate()}</StageText>
        <StageText x={0} y={64} size={8.5} color="var(--v3-fnt)" style={{ width: 62, textAlign: "center" }}>{`${weekday} ${formatClock(date.toISOString())}`}</StageText>
      </Paper>
      <span className="assistant-home-flag" style={{ left: 123, top: 46 }}>{daysLeft === 0 ? t("今天截止") : t("还剩 {value0} 天", { value0: daysLeft })}</span>
    </>
  );
}
