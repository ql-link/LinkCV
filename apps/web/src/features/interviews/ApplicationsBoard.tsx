import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  CalendarDays,
  GripVertical,
  Plus,
  RefreshCw,
  Trophy,
  Bell,
} from "lucide-react";
import { ApiRequestError, api, type ApplicationStageType, type InterviewCalendarColor, type JobApplicationSummary } from "@/api/client";
import { careerApplicationPath, navigateTo } from "../../routing";

export type ProgressColumnKey = string;

export type ProgressColumnDescriptor = {
  key: ProgressColumnKey;
  label: string;
  stageType: ApplicationStageType | null;
  roundNo: number | null;
  stageLabel: string;
  order: number;
  isEnded?: boolean;
};

type ProgressColumn = ProgressColumnDescriptor & {
  items: JobApplicationSummary[];
};

export const CAREER_APPLICATIONS_BOARD_SCROLL_STORAGE_KEY =
  "linkcv:career-applications:board-scroll-left";

export type ProgressSummaryMetrics = {
  active: number;
  weekly: number;
  followUp: number;
  offers: number;
};

export const PROGRESS_COLUMNS: ProgressColumnDescriptor[] = [
  {
    key: "screening:筛选中",
    label: "筛选中",
    stageType: "screening",
    roundNo: null,
    stageLabel: "筛选中",
    order: 0,
  },
  {
    key: "screening:等待沟通",
    label: "等待沟通",
    stageType: "screening",
    roundNo: null,
    stageLabel: "等待沟通",
    order: 1,
  },
  {
    key: "interview:1:一面",
    label: "一面",
    stageType: "interview",
    roundNo: 1,
    stageLabel: "一面",
    order: 2,
  },
  {
    key: "interview:2:二面",
    label: "二面",
    stageType: "interview",
    roundNo: 2,
    stageLabel: "二面",
    order: 3,
  },
  {
    key: "hr:HR 面",
    label: "HR 面",
    stageType: "hr",
    roundNo: null,
    stageLabel: "HR 面",
    order: 100,
  },
  {
    key: "offer:Offer",
    label: "Offer",
    stageType: "offer",
    roundNo: null,
    stageLabel: "Offer",
    order: 101,
  },
  {
    key: "ended",
    label: "已结束",
    stageType: null,
    roundNo: null,
    stageLabel: "已结束",
    order: 1000,
    isEnded: true,
  },
];

export function progressColumnKey(application: JobApplicationSummary): ProgressColumnKey {
  return stageDescriptorForApplication(application).key;
}

export function interviewRoundLabel(roundNo: number): string {
  if (roundNo === 1) return "一面";
  if (roundNo === 2) return "二面";
  return `第 ${roundNo} 轮`;
}

function stageLabelFor(
  stageType: ApplicationStageType,
  roundNo: number | null,
  stageLabel: string,
): string {
  const normalizedLabel = stageLabel.trim();
  if (normalizedLabel) return normalizedLabel;
  if (stageType === "screening") return "筛选中";
  if (stageType === "interview") return interviewRoundLabel(roundNo ?? 1);
  return stageType === "hr" ? "HR 面" : "Offer";
}

function stageColumnKey(
  stageType: ApplicationStageType,
  roundNo: number | null,
  stageLabel: string,
): ProgressColumnKey {
  const label = stageLabelFor(stageType, roundNo, stageLabel);
  if (stageType === "screening") return `screening:${label}`;
  if (stageType === "interview") return `interview:${roundNo ?? 0}:${label}`;
  return `${stageType}:${label}`;
}

function stageOrder(
  stageType: ApplicationStageType,
  roundNo: number | null,
  stageLabel: string,
): number {
  const label = stageLabelFor(stageType, roundNo, stageLabel);
  if (stageType === "screening") {
    if (label === "筛选中") return 0;
    if (label === "等待沟通") return 1;
    return 1.5;
  }
  if (stageType === "interview") {
    return 2 + Math.max(0, (roundNo ?? 1) - 1);
  }
  return stageType === "hr" ? 100 : 101;
}

function stageDescriptor(
  stageType: ApplicationStageType,
  roundNo: number | null,
  stageLabel: string,
): ProgressColumnDescriptor {
  const label = stageLabelFor(stageType, roundNo, stageLabel);
  const key = stageColumnKey(stageType, roundNo, label);
  const base = PROGRESS_COLUMNS.find((column) => column.key === key);
  if (base) return base;
  return {
    key,
    label,
    stageType,
    roundNo: stageType === "interview" ? roundNo : null,
    stageLabel: label,
    order: stageOrder(stageType, roundNo, label),
  };
}

function stageDescriptorForApplication(
  application: JobApplicationSummary,
): ProgressColumnDescriptor {
  if (application.archived_at || application.status !== "active") {
    return PROGRESS_COLUMNS[PROGRESS_COLUMNS.length - 1];
  }
  return stageDescriptor(
    application.current_stage_type,
    application.current_round_no,
    application.current_stage_label,
  );
}

function compareProgressColumns(
  left: ProgressColumnDescriptor,
  right: ProgressColumnDescriptor,
): number {
  const orderDifference = left.order - right.order;
  if (orderDifference !== 0) return orderDifference;
  const leftBaseIndex = PROGRESS_COLUMNS.findIndex((column) => column.key === left.key);
  const rightBaseIndex = PROGRESS_COLUMNS.findIndex((column) => column.key === right.key);
  if (leftBaseIndex !== -1 || rightBaseIndex !== -1) {
    if (leftBaseIndex === -1) return 1;
    if (rightBaseIndex === -1) return -1;
    return leftBaseIndex - rightBaseIndex;
  }
  return left.label.localeCompare(right.label, "zh-CN");
}

export function buildProgressColumns(
  applications: JobApplicationSummary[],
): ProgressColumn[] {
  const itemsByColumn = new Map<ProgressColumnKey, JobApplicationSummary[]>();
  const descriptors = new Map<ProgressColumnKey, ProgressColumnDescriptor>(
    PROGRESS_COLUMNS.map((column) => [column.key, column]),
  );
  for (const application of applications) {
    const descriptor = stageDescriptorForApplication(application);
    if (!descriptors.has(descriptor.key)) descriptors.set(descriptor.key, descriptor);
    const items = itemsByColumn.get(descriptor.key) ?? [];
    items.push(application);
    itemsByColumn.set(descriptor.key, items);
  }
  return [...descriptors.values()]
    .sort(compareProgressColumns)
    .map((column) => ({
      ...column,
      items: itemsByColumn.get(column.key) ?? [],
    }));
}

export function applicationStatusLabel(application: JobApplicationSummary): string {
  if (application.archived_at) return "已归档";
  if (application.status === "rejected") return "未通过";
  if (application.status === "withdrawn") return "已主动结束";
  if (application.status === "closed") return application.offer_status === "accepted" ? "已接受 Offer" : "已结束";
  return application.stage_state === "awaiting_schedule"
    ? "等待安排"
    : application.stage_state === "awaiting_result"
      ? "等待结果"
      : application.stage_state === "negotiating"
        ? "Offer 沟通中"
        : "进行中";
}

export function formatApplicationDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function formatApplicationDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function createCareerApplicationsMock(): JobApplicationSummary[] {
  const now = new Date();
  const dateAt = (days: number, hour = 10) => {
    const value = new Date(now);
    value.setDate(value.getDate() + days);
    value.setHours(hour, 0, 0, 0);
    return value.toISOString();
  };
  const build = (
    id: string,
    company: string,
    role: string,
    stageType: ApplicationStageType,
    stageLabel: string,
    color: InterviewCalendarColor,
    overrides: Partial<JobApplicationSummary> = {},
  ): JobApplicationSummary => ({
    id: `mock-application-${id}`,
    job_description_id: null,
    resume_version_id: null,
    company_name_snapshot: company,
    job_title_snapshot: role,
    job_snapshot: {},
    resume_title_snapshot: `简历 v2.${Number(id) % 3}`,
    calendar_color: color,
    current_stage_type: stageType,
    current_round_no: stageType === "interview" ? 1 : null,
    current_stage_label: stageLabel,
    stage_state: "awaiting_result",
    status: "active",
    offer_status: "none",
    is_favorite: false,
    applied_at: dateAt(-Number(id), 9),
    notes: null,
    archived_at: null,
    lock_version: 1,
    created_at: dateAt(-Number(id) - 2, 9),
    updated_at: dateAt(-Math.ceil(Number(id) / 4), 12),
    next_session_id: null,
    next_session_start_at: null,
    next_session_end_at: null,
    next_session_mode: null,
    ...overrides,
  });

  return [
    build("1", "百度", "算法工程师（NLP）", "screening", "筛选中", "blue"),
    build("2", "小米", "后端开发工程师", "screening", "筛选中", "orange"),
    build("3", "美团", "数据分析师", "screening", "筛选中", "yellow"),
    build("4", "小红书", "产品运营（社区）", "screening", "筛选中", "red"),
    build("5", "BOSS直聘", "商业产品经理", "screening", "筛选中", "green"),
    build("6", "腾讯", "产品经理（PCG）", "screening", "等待沟通", "blue", { stage_state: "awaiting_schedule" }),
    build("7", "字节跳动", "数据科学家", "screening", "等待沟通", "blue", { stage_state: "awaiting_schedule" }),
    build("8", "阿里云", "云计算研发工程师", "screening", "等待沟通", "orange", { stage_state: "awaiting_schedule" }),
    build("9", "腾讯", "前端开发工程师", "interview", "一面", "blue", { current_round_no: 1, stage_state: "scheduled", next_session_id: "mock-session-9", next_session_start_at: dateAt(1, 10), next_session_end_at: dateAt(1, 11), next_session_mode: "video" }),
    build("10", "字节跳动", "算法工程师", "interview", "一面", "blue", { current_round_no: 1, stage_state: "scheduled", next_session_id: "mock-session-10", next_session_start_at: dateAt(2, 14), next_session_end_at: dateAt(2, 15), next_session_mode: "video" }),
    build("11", "美团", "用户研究员", "interview", "一面", "yellow", { current_round_no: 1, stage_state: "scheduled", next_session_id: "mock-session-11", next_session_start_at: dateAt(3, 10), next_session_end_at: dateAt(3, 11), next_session_mode: "video" }),
    build("12", "小红书", "产品经理", "interview", "一面", "red", { current_round_no: 1, stage_state: "scheduled", next_session_id: "mock-session-12", next_session_start_at: dateAt(4, 15), next_session_end_at: dateAt(4, 16), next_session_mode: "onsite" }),
    build("13", "阿里云", "后端开发工程师", "interview", "二面", "orange", { current_round_no: 2, stage_state: "scheduled", next_session_id: "mock-session-13", next_session_start_at: dateAt(5, 14), next_session_end_at: dateAt(5, 15), next_session_mode: "video" }),
    build("14", "腾讯", "测试开发工程师", "interview", "二面", "blue", { current_round_no: 2, stage_state: "scheduled", next_session_id: "mock-session-14", next_session_start_at: dateAt(6, 10), next_session_end_at: dateAt(6, 11), next_session_mode: "video" }),
    build("15", "字节跳动", "运营经理（商业化）", "hr", "HR 面", "blue", { stage_state: "scheduled", next_session_id: "mock-session-15", next_session_start_at: dateAt(7, 16), next_session_end_at: dateAt(7, 17), next_session_mode: "video" }),
    build("16", "美团", "数据分析师", "offer", "Offer", "yellow", { stage_state: "negotiating", offer_status: "written_offer_received" }),
    build("17", "阿里云", "云计算研发工程师", "offer", "Offer", "orange", { stage_state: "negotiating", offer_status: "written_offer_received" }),
    build("18", "小米", "算法工程师", "interview", "已结束", "orange", { status: "withdrawn", current_round_no: 1, stage_state: "awaiting_result" }),
    build("19", "百度", "后端开发工程师", "interview", "已结束", "blue", { status: "rejected", current_round_no: 2, stage_state: "awaiting_result", resume_title_snapshot: "简历 v1.9" }),
  ];
}

export function ApplicationsBoard({
  visibleApplications,
  displayMode,
  isUsingMock,
  metrics,
  onCreate,
  onChanged,
  onNotice,
}: {
  visibleApplications: JobApplicationSummary[];
  displayMode: "board" | "list";
  isUsingMock: boolean;
  metrics: ProgressSummaryMetrics;
  onCreate: () => void;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  return (
    <>
      <ProgressSummaryBar metrics={metrics} isUsingMock={isUsingMock} />
      {displayMode === "board" && visibleApplications.length > 0 && (
        <ProgressBoard
          applications={visibleApplications}
          isUsingMock={isUsingMock}
          onCreate={onCreate}
          onChanged={onChanged}
          onNotice={onNotice}
        />
      )}
    </>
  );
}

export function ProgressSummaryBar({
  metrics,
  isUsingMock,
}: {
  metrics: ProgressSummaryMetrics;
  isUsingMock: boolean;
}) {
  const entries = [
    {
      icon: <RefreshCw />,
      tone: "career",
      label: "进行中",
      value: metrics.active,
      change: isUsingMock ? "+2" : undefined,
      hint: isUsingMock ? undefined : "当前全部进程",
    },
    {
      icon: <CalendarDays />,
      tone: "neutral",
      label: "本周待面试",
      value: metrics.weekly,
      change: isUsingMock ? "+1" : undefined,
      hint: isUsingMock ? undefined : "已安排场次",
    },
    {
      icon: <Bell />,
      tone: "neutral",
      label: "待跟进",
      value: metrics.followUp,
      hint: "需要及时跟进",
    },
    {
      icon: <Trophy />,
      tone: "neutral",
      label: "已拿 Offer",
      value: metrics.offers,
      change: isUsingMock ? "+1" : undefined,
      hint: isUsingMock ? undefined : "书面 Offer",
    },
  ];
  return (
    <section className="career-application-summary-bar" aria-label="求职进程数据概览">
      {entries.map((entry, index) => (
        <article key={entry.label} className={index > 0 ? "has-divider" : undefined}>
          <span className={`career-summary-icon tone-${entry.tone}`} aria-hidden="true">{entry.icon}</span>
          <div>
            <small>{entry.label}</small>
            <strong>{entry.value}</strong>
            <p>{entry.change && <>较上周 <b>{entry.change}</b></>}{entry.hint}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

export function ProgressBoard({
  applications,
  isUsingMock,
  onCreate,
  onChanged,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  isUsingMock: boolean;
  onCreate: () => void;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ProgressColumnKey | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const boardRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ id: string; source: ProgressColumnKey } | null>(null);
  const panRef = useRef<{ startX: number; startScrollLeft: number; moved: boolean } | null>(null);
  const autoScrollRef = useRef<{ direction: -1 | 1; timer: number } | null>(null);
  const columns = useMemo(() => buildProgressColumns(applications), [applications]);

  const persistBoardScroll = (board: HTMLElement | null = boardRef.current) => {
    if (!board) return;
    try {
      window.sessionStorage.setItem(
        CAREER_APPLICATIONS_BOARD_SCROLL_STORAGE_KEY,
        String(Math.max(0, board.scrollLeft)),
      );
    } catch {
      // sessionStorage can be disabled or unavailable in privacy modes.
    }
  };

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    try {
      const stored = window.sessionStorage.getItem(
        CAREER_APPLICATIONS_BOARD_SCROLL_STORAGE_KEY,
      );
      const scrollLeft = stored === null ? NaN : Number(stored);
      if (Number.isFinite(scrollLeft) && scrollLeft >= 0) board.scrollLeft = scrollLeft;
    } catch {
      // A failed restore should not prevent the board from rendering.
    }
    return () => {
      persistBoardScroll(board);
      const activeAutoScroll = autoScrollRef.current;
      if (activeAutoScroll) window.clearInterval(activeAutoScroll.timer);
      autoScrollRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (!isPanning) return;
    const move = (event: MouseEvent) => {
      const board = boardRef.current;
      const pan = panRef.current;
      if (!board || !pan) return;
      const delta = event.clientX - pan.startX;
      if (Math.abs(delta) > 2) pan.moved = true;
      board.scrollLeft = pan.startScrollLeft - delta;
      if (pan.moved) event.preventDefault();
    };
    const end = () => {
      panRef.current = null;
      setIsPanning(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("blur", end);
    };
  }, [isPanning]);

  const stopAutoScroll = () => {
    const current = autoScrollRef.current;
    if (current) window.clearInterval(current.timer);
    autoScrollRef.current = null;
  };

  const scrollAtEdge = (direction: -1 | 1) => {
    const board = boardRef.current;
    if (!board) return;
    const current = board.scrollLeft;
    const maxScrollLeft = Math.max(0, board.scrollWidth - board.clientWidth);
    const next = Math.max(0, Math.min(maxScrollLeft, current + direction * 12));
    board.scrollLeft = next;
    if (next === current) stopAutoScroll();
  };

  const updateAutoScroll = (clientX: number) => {
    const board = boardRef.current;
    if (!board || !Number.isFinite(clientX)) return;
    const rect = board.getBoundingClientRect();
    const left = rect.left;
    const right = rect.right || left + board.clientWidth;
    if (right <= left) {
      stopAutoScroll();
      return;
    }
    const edgeSize = Math.min(56, Math.max(32, (right - left) * 0.12));
    const direction: -1 | 1 | 0 = clientX <= left + edgeSize
      ? -1
      : clientX >= right - edgeSize
        ? 1
        : 0;
    if (!direction) {
      stopAutoScroll();
      return;
    }
    const current = autoScrollRef.current;
    if (current?.direction === direction) return;
    stopAutoScroll();
    scrollAtEdge(direction);
    if (board.scrollLeft === 0 && direction === -1) return;
    const maxScrollLeft = Math.max(0, board.scrollWidth - board.clientWidth);
    if (board.scrollLeft >= maxScrollLeft && direction === 1) return;
    autoScrollRef.current = {
      direction,
      timer: window.setInterval(() => scrollAtEdge(direction), 16),
    };
  };

  const clearDrag = () => {
    stopAutoScroll();
    dragRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  };

  const handleDragStart = (item: JobApplicationSummary, event: ReactDragEvent<HTMLElement>) => {
    const source = progressColumnKey(item);
    dragRef.current = { id: item.id, source };
    setDraggingId(item.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
    }
  };

  const handleDrop = async (target: ProgressColumnDescriptor, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    const draggedId = event.dataTransfer?.getData("text/plain") || dragRef.current?.id;
    const drag = dragRef.current;
    clearDrag();
    if (!draggedId || !drag) return;
    const application = applications.find((item) => item.id === draggedId);
    if (!application) return;
    if (isUsingMock) {
      onNotice("展示数据仅用于演示，拖动不会写入求职进程。");
      return;
    }
    const source = columns.find((column) => column.key === drag.source)
      ?? stageDescriptorForApplication(application);
    if (target.key === source.key) return;
    if (target.isEnded) {
      onNotice("结束结果需要进入求职进程详情选择，拖动不会替你决定未通过或主动结束。");
      return;
    }
    if (source.isEnded) {
      onNotice("已结束的求职进程不能拖回活动阶段，请在详情中查看历史记录。");
      return;
    }
    if (target.order <= source.order) {
      onNotice("后端仅支持向前推进，同一阶段或逆向拖动不会写入。");
      return;
    }
    if (application.stage_state !== "awaiting_result") {
      onNotice("只有当前阶段已完成并等待结果时才能拖动推进，请先在详情中处理。");
      return;
    }
    if (!target.stageType) {
      onNotice("目标阶段不可用，请在求职进程详情中处理。");
      return;
    }
    const transition = {
      target_stage_type: target.stageType,
      target_round_no: target.roundNo,
      target_stage_label: target.stageLabel,
    };
    try {
      await api.advanceJobApplication(application.id, {
        ...transition,
        base_lock_version: application.lock_version,
      });
      onChanged();
    } catch (error) {
      onNotice(applicationTransitionError(error));
    }
  };

  const handleBoardWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (!event.shiftKey) return;
    const board = boardRef.current;
    if (!board) return;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? event.deltaY
      : event.deltaX;
    if (!delta) return;
    event.preventDefault();
    board.scrollLeft += delta;
  };

  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    return target instanceof Element
      && Boolean(target.closest("button, a, input, select, textarea, [draggable='true'], [role='button']"));
  };

  const handleBoardMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    const board = boardRef.current;
    if (!board) return;
    panRef.current = {
      startX: event.clientX,
      startScrollLeft: board.scrollLeft,
      moved: false,
    };
    setIsPanning(true);
    event.preventDefault();
  };

  return (
    <section
      ref={boardRef}
      className={`interview-surface career-applications-board progress-board-surface${isPanning ? " is-panning" : ""}`}
      aria-label="求职进程看板"
      onWheel={handleBoardWheel}
      onScroll={() => persistBoardScroll()}
      onMouseDown={handleBoardMouseDown}
      onDragOver={(event) => updateAutoScroll(event.clientX)}
      onDrop={stopAutoScroll}
    >
      <div
        className="progress-board-grid"
        style={{ "--progress-column-count": columns.length } as CSSProperties}
      >
        {columns.map((column) => (
          <ProgressColumn
            key={column.key}
            column={column}
            draggingId={draggingId}
            dropTarget={dropTarget}
            onCreate={onCreate}
            onDragStart={handleDragStart}
            onDragEnd={clearDrag}
            onDragOver={(event) => {
              event.preventDefault();
              if (draggingId) setDropTarget(column.key);
              updateAutoScroll(event.clientX);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDropTarget(null);
            }}
            onDrop={(event) => void handleDrop(column, event)}
            isUsingMock={isUsingMock}
          />
        ))}
      </div>
    </section>
  );
}

export function ProgressColumn({
  column,
  draggingId,
  dropTarget,
  onCreate,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  isUsingMock,
}: {
  column: ProgressColumn;
  draggingId: string | null;
  dropTarget: ProgressColumnKey | null;
  onCreate: () => void;
  onDragStart: (item: JobApplicationSummary, event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  isUsingMock: boolean;
}) {
  return (
    <div
      className={`progress-column ${dropTarget === column.key ? "is-drop-target" : ""}`}
      data-column-key={column.key}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="progress-column-heading">
        <h3>{column.label}<span>{column.items.length}</span></h3>
        <GripVertical aria-hidden="true" />
      </header>
      <div className="progress-column-cards">
        {column.items.map((item) => (
          <ProgressCard
            key={item.id}
            item={item}
            column={column}
            isDragging={draggingId === item.id}
            isUsingMock={isUsingMock}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
        {!column.items.length && <p className="pipeline-empty">暂无进程</p>}
      </div>
      <AddProgressAction onClick={onCreate} />
    </div>
  );
}

export function ProgressCard({
  item,
  column,
  isDragging,
  isUsingMock,
  onDragStart,
  onDragEnd,
}: {
  item: JobApplicationSummary;
  column: ProgressColumnDescriptor;
  isDragging: boolean;
  isUsingMock: boolean;
  onDragStart: (item: JobApplicationSummary, event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const timeLabel = applicationCardTimeLabel(item, column);
  const isScreeningColumn = column.stageType === "screening";
  const open = !isUsingMock ? () => navigateTo(careerApplicationPath(item.id)) : undefined;
  const content = (
    <>
      <CompanyLogo item={{ company: item.company_name_snapshot, logo: item.company_name_snapshot.slice(0, 1), color: item.calendar_color }} />
      <span className="progress-card-copy">
        <strong title={item.company_name_snapshot}>{item.company_name_snapshot}</strong>
        <small title={item.job_title_snapshot}>{item.job_title_snapshot}</small>
      </span>
    </>
  );
  return (
    <article
      className={`progress-card ${isDragging ? "is-dragging" : ""}`}
      aria-label={`${item.company_name_snapshot} ${item.job_title_snapshot}`}
      draggable
      onDragStart={(event) => onDragStart(item, event)}
      onDragEnd={onDragEnd}
    >
      <div className="progress-card-main-row">
        {open ? <button type="button" className="progress-card-open" aria-label={`查看 ${item.company_name_snapshot} ${item.job_title_snapshot} 求职进程`} onClick={open}>{content}</button> : <div className="progress-card-open is-static">{content}</div>}
        {isScreeningColumn
          ? <span className="progress-card-actions" aria-hidden="true"><GripVertical /></span>
          : <StageBadge item={item} column={column} />}
      </div>
      <div className="progress-card-meta">
        <time className="progress-card-time">{timeLabel}</time>
        {isScreeningColumn && <StageBadge item={item} column={column} />}
      </div>
    </article>
  );
}

function applicationCardTimeLabel(item: JobApplicationSummary, column: ProgressColumnDescriptor): string {
  if (item.next_session_start_at) {
    const nextStep = column.stageType === "interview"
      ? item.current_stage_label
      : column.stageType === "hr"
        ? "HR 面"
        : item.current_stage_label;
    return `下次：${nextStep} ${formatApplicationDate(item.next_session_start_at)}`;
  }
  if (column.stageType === "offer") {
    return item.applied_at ? `Offer ${formatApplicationDate(item.applied_at)}` : "Offer";
  }
  return item.applied_at ? `投递 ${formatApplicationDate(item.applied_at)}` : "暂未排期";
}

export function StageBadge({ item, column }: { item: JobApplicationSummary; column: ProgressColumnDescriptor }) {
  const label = column.label;
  const tone = column.isEnded
    ? "muted"
    : column.stageType === "screening"
      ? "muted"
      : column.stageType === "interview"
      ? (item.current_round_no ?? 1) <= 1 ? "blue" : "purple"
      : column.stageType === "hr" ? "hr" : "offer";
  return <span className={`stage-badge stage-badge-${tone}`}>{label}</span>;
}

export function AddProgressAction({ onClick }: { onClick: () => void }) {
  return <button type="button" className="career-pipeline-add" onClick={onClick}><Plus />添加进程</button>;
}

function CompanyLogo({ item }: { item: { company: string; logo: string; color: InterviewCalendarColor } }) {
  return <span className={`company-logo calendar-${item.color}`} aria-hidden="true">{item.logo}</span>;
}

function applicationTransitionError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const messages: Record<string, string> = {
      INTERVIEW_INVALID_TRANSITION: "当前求职进度不允许执行这个操作。",
      INTERVIEW_EDIT_CONFLICT: "这条求职进程已在其他页面更新，请刷新后再试。",
    };
    return messages[error.message] ?? `操作失败：${error.message}`;
  }
  return "操作失败，请稍后重试。";
}
