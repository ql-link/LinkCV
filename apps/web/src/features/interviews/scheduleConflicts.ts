// 面试日程时间冲突检测（设计稿 10.3「面试日程时间冲突」）：
// 只看未来、未取消、未完成的安排，两段 [start, end) 有交集即算冲突。
import type { InterviewSessionSummary } from "../../api/client";

export type ScheduleConflict = {
  key: string;
  first: InterviewSessionSummary;
  second: InterviewSessionSummary;
};

// 把一条安排的时间段取出来；「截止前完成」的笔试按用户的作答计划算，没有计划就不参与冲突
function interval(session: InterviewSessionSummary) {
  const start = session.schedule_kind === "open_window" ? session.answer_plan_start_at : session.start_at;
  const end = session.schedule_kind === "open_window" ? session.answer_plan_end_at : session.end_at;
  if (!start || !end) return null;
  const from = Date.parse(start);
  const to = Date.parse(end);
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
}

export function findScheduleConflicts(sessions: InterviewSessionSummary[], now = Date.now()): ScheduleConflict[] {
  const upcoming = sessions
    .filter((session) => session.status === "scheduled")
    .map((session) => ({ session, range: interval(session) }))
    .filter((item): item is { session: InterviewSessionSummary; range: { from: number; to: number } } => Boolean(item.range && item.range.to > now))
    .sort((a, b) => a.range.from - b.range.from);
  const conflicts: ScheduleConflict[] = [];
  for (let i = 0; i < upcoming.length; i += 1) {
    for (let j = i + 1; j < upcoming.length && upcoming[j].range.from < upcoming[i].range.to; j += 1) {
      const [first, second] = [upcoming[i].session, upcoming[j].session];
      conflicts.push({ key: [first.id, second.id].sort().join(":"), first, second });
    }
  }
  return conflicts;
}

function shortCompany(name: string) {
  return name.replace(/(科技|网络|信息技术|集团|股份|有限公司|（中国）|\(中国\))+$/g, "") || name;
}

// 文案对齐设计稿：「10-09 14:00 阿里二面和美团笔试时间重叠。」
export function describeScheduleConflict(conflict: ScheduleConflict, timezone?: string) {
  const start = new Date(interval(conflict.second)?.from ?? Date.parse(conflict.second.start_at));
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(start);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const label = (session: InterviewSessionSummary) => `${shortCompany(session.company_name)}${session.stage_label}`;
  return `${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")} ${label(conflict.first)}和${label(conflict.second)}时间重叠。`;
}
