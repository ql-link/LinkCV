// 07 模拟面试（文字一期）各页面共用的小件：时间格式化、场次订阅 hook、雷达图、题目分组。
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DIFFICULTY_LABELS,
  INTERVIEW_TYPE_LABELS,
  mockInterviewApi,
  mockInterviewErrorMessage,
  subscribeMockInterviews,
  type MockInterviewDetail,
  type MockInterviewQuestion,
  type MockInterviewStatus,
  type MockInterviewSummary,
} from "./mockInterviewApi";

const pad = (value: number) => String(value).padStart(2, "0");
const WEEK = "日一二三四五六";

export function mmdd(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function hhmm(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function dateTimeLabel(iso: string | null | undefined) {
  return iso ? `${mmdd(iso)} ${hhmm(iso)}` : "";
}

export function weekday(iso: string) {
  return `周${WEEK[new Date(iso).getDay()]}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// 日期卡顶部色带：今天 / 明天 / MM-DD
export function dayBand(iso: string, now = new Date()) {
  const days = Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / 86_400_000);
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  return mmdd(iso);
}

// 距离开始还有多久：「5 小时后」「32 分钟后」「3 天后」
export function countdown(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟后`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时后`;
  return `${Math.round(minutes / 60 / 24)} 天后`;
}

// 「18 分钟前」
export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时前`;
  return `${Math.round(minutes / 60 / 24)} 天前`;
}

// 计时器 mm:ss（超过一小时显示 h:mm:ss）
export function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function charCount(text: string | null | undefined) {
  return [...(text ?? "").replace(/\s/g, "")].length;
}

export function interviewTitle(item: Pick<MockInterviewSummary, "company_name" | "job_title" | "target_role" | "interview_type">) {
  if (item.company_name) return `${item.company_name}${item.job_title ? ` · ${item.job_title}` : ""}`;
  if (item.target_role) return item.target_role;
  return `通用练习 · ${INTERVIEW_TYPE_LABELS[item.interview_type]}`;
}

export function typeDifficulty(item: Pick<MockInterviewSummary, "interview_type" | "difficulty">) {
  return `${INTERVIEW_TYPE_LABELS[item.interview_type]} · ${DIFFICULTY_LABELS[item.difficulty]}`;
}

// 07.2 页头标题：「模拟面试 · 三面准备」/ 无阶段时「模拟面试 · 通用练习」
export function sessionHeading(item: Pick<MockInterviewSummary, "stage_label">) {
  return item.stage_label ? `模拟面试 · ${item.stage_label}准备` : "模拟面试 · 通用练习";
}

export function sessionEyebrow(item: MockInterviewSummary) {
  return [item.company_name ? interviewTitle(item) : null, INTERVIEW_TYPE_LABELS[item.interview_type], DIFFICULTY_LABELS[item.difficulty]].filter(Boolean).join(" · ");
}

export const STATUS_LABELS: Record<MockInterviewStatus, string> = {
  preparing: "准备中",
  preparation_failed: "准备失败",
  in_progress: "进行中",
  evaluating: "评估中",
  evaluation_failed: "评估失败",
  completed: "已完成",
  abandoned: "已放弃",
};

// 分数配色：≥75 绿，≥60 橙，其余红（报告逐题、练习记录共用）
export function scoreTone(score: number) {
  if (score >= 75) return "is-good";
  if (score >= 60) return "is-mid";
  return "is-bad";
}

export function scoreGrade(score: number) {
  if (score >= 85) return "优秀";
  if (score >= 70) return "良好";
  if (score >= 60) return "合格";
  return "待提升";
}

// 主问题与其追问组成一组，按出现顺序
export type QuestionGroup = { root: MockInterviewQuestion; follows: MockInterviewQuestion[]; index: number };

export function groupQuestions(questions: MockInterviewQuestion[]): QuestionGroup[] {
  const groups: QuestionGroup[] = [];
  const byId = new Map<string, QuestionGroup>();
  [...questions].sort((a, b) => a.sequence_no - b.sequence_no).forEach((question) => {
    if (question.kind === "main" || !question.parent_id) {
      const group = { root: question, follows: [], index: groups.length + 1 };
      groups.push(group);
      byId.set(question.id, group);
    } else {
      byId.get(question.parent_id)?.follows.push(question);
    }
  });
  return groups;
}

// 场次详情：首次加载 + 订阅假数据变化（后台准备 / 评估推进时自动刷新）。
// pause() 用于 SSE 回合进行中：此时数据层已经写入下一题，不能提前显示。
export function useMockInterview(id: string | undefined) {
  const [interview, setInterview] = useState<MockInterviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const paused = useRef(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const { mock_interview } = await mockInterviewApi.get(id);
      if (alive.current) { setInterview(mock_interview); setError(null); }
    } catch (reason) {
      if (alive.current) setError(mockInterviewErrorMessage(reason));
    }
  }, [id]);

  useEffect(() => {
    alive.current = true;
    setInterview(null);
    setError(null);
    void refresh();
    const unsubscribe = subscribeMockInterviews(() => { if (!paused.current) void refresh(); });
    return () => { alive.current = false; unsubscribe(); };
  }, [refresh]);

  const pause = useCallback((value: boolean) => { paused.current = value; }, []);
  return { interview, error, refresh, pause, setInterview };
}

// 每秒刷新一次的当前时间（计时器、倒计时用）
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/* ───────────── 雷达图（07.1 能力雷达 / 07.3 能力维度） ───────────── */

export function RadarChart({
  items,
  width,
  height,
  radius,
  cy,
  weakIndex,
  showRings = true,
}: {
  items: Array<{ label: string; value: number }>;
  width: number;
  height: number;
  radius: number;
  cy: number;
  weakIndex?: number;
  showRings?: boolean;
}) {
  const cx = width / 2;
  const count = Math.max(3, items.length);
  const point = (index: number, ratio: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return [cx + Math.cos(angle) * radius * ratio, cy + Math.sin(angle) * radius * ratio] as const;
  };
  const polygon = (ratio: number) => Array.from({ length: count }, (_, index) => point(index, ratio).join(",")).join(" ");
  const shape = items.map((item, index) => point(index, Math.max(0.05, item.value / 5)).join(",")).join(" ");
  return (
    <svg className="mi-radar" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {showRings && [0.2, 0.4, 0.6, 0.8].map((ratio) => <polygon key={ratio} points={polygon(ratio)} fill="none" stroke="var(--v3-line)" />)}
      <polygon points={polygon(1)} fill="#fafaf9" stroke="var(--v3-line)" />
      {Array.from({ length: count }, (_, index) => {
        const [x, y] = point(index, 1);
        return <line key={index} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--v3-line)" />;
      })}
      <polygon points={shape} fill="rgb(63 111 216 / 16%)" stroke="var(--v3-bl)" strokeWidth="1.2" />
      {items.map((item, index) => {
        const [x, y] = point(index, Math.max(0.05, item.value / 5));
        return <circle key={item.label} cx={x} cy={y} r="3" fill={index === weakIndex ? "var(--v3-or)" : "var(--v3-bl)"} stroke="#fff" strokeWidth="1" />;
      })}
    </svg>
  );
}

// 雷达图标签位置：顶点外侧再推 labelGap
export function radarLabelPosition(index: number, count: number, cx: number, cy: number, radius: number) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, cos: Math.cos(angle), sin: Math.sin(angle) };
}

// 面试官头像（设计稿 icon/feather：圆底羽毛笔）
export function InterviewerMark({ size = 24 }: { size?: number }) {
  return (
    <span className="mi-feather" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 4c-7 0-12 5-13 12l-2 4" />
        <path d="M20 4c0 7-5 11-11 11" />
        <path d="M9 15l4-4" />
      </svg>
    </span>
  );
}
