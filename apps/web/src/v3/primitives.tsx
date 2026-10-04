import { t, useLocale, weekdayName, weekdays } from "@/i18n";
import {
  createContext,
  isValidElement,
  useContext,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type V3IconName } from "./Icon";
import { MotionPresence, useContentMotion, useExitPresence } from "../components/ui/motion";

/* ───────────────────────── 浮层定位 ───────────────────────── */

type Placement = "bottom-start" | "bottom-end" | "top-start" | "top-end" | "right-start";

// 根据触发元素的位置计算浮层坐标；空间不够时自动翻转到另一侧
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  open: boolean,
  placement: Placement = "bottom-start",
  offset = 6,
) {
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;
    const a = anchor.getBoundingClientRect();
    const f = floating.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top: number;
    let left: number;
    if (placement === "right-start") {
      left = a.right + offset;
      top = a.top;
    } else {
      const wantsTop = placement.startsWith("top");
      const below = a.bottom + offset;
      const above = a.top - offset - f.height;
      top = wantsTop ? (above < 8 ? below : above) : (below + f.height > vh - 8 && above > 8 ? above : below);
      left = placement.endsWith("end") ? a.right - f.width : a.left;
    }
    left = Math.max(8, Math.min(left, vw - f.width - 8));
    top = Math.max(8, Math.min(top, vh - f.height - 8));
    setStyle({
      top, left,
      "--motion-x": placement === "right-start" ? "-4px" : "0px",
      "--motion-y": placement === "right-start" ? "0px" : top < a.top ? "4px" : "-4px",
      transformOrigin: placement === "right-start" ? "left top" : top < a.top ? "bottom" : "top",
    } as CSSProperties);
  }, [anchorRef, floatingRef, offset, placement]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle({ visibility: "hidden" });
      return;
    }
    update();
    const handler = () => update();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [open, update]);
  return style;
}

const PopoverAncestors = createContext<readonly string[]>([]);

// 点击浮层外部或按 Esc 时关闭；portal 子浮层保留 React 层级。
export function useDismiss(open: boolean, onClose: () => void, refs: Array<RefObject<HTMLElement | null>>) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      const owners = target instanceof Element ? target.closest<HTMLElement>("[data-v3-popover-ancestors]")?.dataset.v3PopoverAncestors?.split(" ") ?? [] : [];
      if (refs.some((ref) => ref.current?.id && owners.includes(ref.current.id))) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const nested = Array.from(document.querySelectorAll<HTMLElement>('[data-v3-popover-ancestors][data-state="open"]'));
        if (nested.some((layer) => refs.some((ref) => ref.current?.id && layer.dataset.v3PopoverAncestors?.split(" ").includes(ref.current.id)))) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
    // refs 是稳定的 ref 对象
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);
}

export function Popover(props: ComponentProps<typeof PopoverSurface>) {
  useLocale();
  return <MotionPresence>{props.open && <PopoverSurface {...props} />}</MotionPresence>;
}

function PopoverSurface({
  anchorRef,
  open,
  onClose,
  placement = "bottom-start",
  offset,
  className = "",
  style,
  role = "dialog",
  label,
  matchWidth = false,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  placement?: Placement;
  offset?: number;
  className?: string;
  style?: CSSProperties;
  role?: string;
  label?: string;
  matchWidth?: boolean;
  children: ReactNode;
}) {
  useLocale();
  const floatingRef = useRef<HTMLDivElement>(null);
  const present = useExitPresence(floatingRef);
  const parentIds = useContext(PopoverAncestors);
  const popoverId = useId();
  const pos = useAnchoredPosition(anchorRef, floatingRef, open, placement, offset);
  useDismiss(open && present, onClose, [floatingRef, anchorRef]);
  if (!open) return null;
  const width = matchWidth ? anchorRef.current?.getBoundingClientRect().width : undefined;
  return createPortal(
    <PopoverAncestors.Provider value={[...parentIds, popoverId]}>
    <div
      id={popoverId}
      data-v3-popover-ancestors={parentIds.join(" ")}
      ref={floatingRef}
      className={`v3 v3-menu ui-motion-popover ${className}`}
      data-state={present ? "open" : "closed"}
      data-side={placement.split("-")[0]}
      inert={!present || undefined}
      aria-hidden={!present || undefined}
      role={role}
      aria-label={label}
      style={{ ...pos, ...(width ? { width } : null), ...style }}
    >
      {children}
    </div>
    </PopoverAncestors.Provider>,
    document.body,
  );
}

/* ───────────────────────── 菜单 ───────────────────────── */

export type MenuItem =
  | { kind?: "item"; label: string; icon?: V3IconName; danger?: boolean; disabled?: boolean; title?: string; onSelect: () => void; checked?: boolean }
  | { kind: "separator" };

export function Menu({
  anchorRef,
  open,
  onClose,
  items,
  placement = "bottom-start",
  label,
  width,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  items: MenuItem[];
  placement?: Placement;
  label?: string;
  width?: number;
}) {
  useLocale();
  return (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} placement={placement} role="menu" label={label} style={width ? { width } : undefined}>
      {items.map((item, index) => item.kind === "separator" ? (
        <div className="v3-menu-sep" role="separator" key={`sep-${index}`} />
      ) : (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`v3-menu-item${item.danger ? " is-danger" : ""}`}
          disabled={item.disabled}
          title={item.title}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.icon && <Icon name={item.icon} size={14} />}
          <span>{item.label}</span>
          {item.checked && <Icon className="v3-menu-check" name="check" size={13} />}
        </button>
      ))}
    </Popover>
  );
}

/* ───────────────────────── 下拉框（自绘） ───────────────────────── */

export type SelectOption<T extends string> = { value: T; label: string; hint?: string };

export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder = "请选择",
  size = "md",
  filled = false,
  disabled = false,
  label,
  className = "",
  id,
}: {
  value: T | null | "";
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  placeholder?: string;
  size?: "md" | "sm";
  filled?: boolean;
  disabled?: boolean;
  label?: string;
  className?: string;
  id?: string;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (open) setActive(Math.max(0, options.findIndex((option) => option.value === value)));
  }, [open, options, value]);

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={`v3-select${size === "sm" ? " is-sm" : ""}${filled ? " is-filled" : ""} ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((next) => !next)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            setOpen(true);
            return;
          }
          if (!open) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(options.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const option = options[active];
            if (option) onChange(option.value);
            setOpen(false);
          }
        }}
      >
        <span className={`v3-select-value${selected ? "" : " is-placeholder"}`}>{selected?.label ?? placeholder}</span>
        <Icon className="v3-select-chev" name="chevd" size={12} />
      </button>
      <Popover anchorRef={buttonRef} open={open} onClose={close} role="listbox" className="v3-select-menu" matchWidth>
        <div id={listId}>
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`v3-menu-item${index === active ? " is-active" : ""}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              <span>{option.label}</span>
              {option.hint && <small style={{ color: "var(--v3-fnt)", fontSize: 11 }}>{option.hint}</small>}
              {option.value === value && <Icon className="v3-menu-check" name="check" size={13} />}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

/* ───────────────────────── 日期时间选择（自绘） ───────────────────────── */

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];
const pad = (value: number) => String(value).padStart(2, "0");

export function formatDateTimeLabel(value: Date | null, withTime = true) {
  if (!value) return "";
  const week = weekdayName(value.getDay());
  const date = t("{value0}-{value1} 周{value2}", { value0: pad(value.getMonth() + 1), value1: pad(value.getDate()), value2: week });
  return withTime ? `${date} ${pad(value.getHours())}:${pad(value.getMinutes())}` : date;
}

export function DateTimeField({
  value,
  onChange,
  placeholder = "选择时间",
  withTime = true,
  minuteStep = 15,
  filled = false,
  size = "md",
  label,
  min,
  icon = "cal",
}: {
  value: Date | null;
  onChange: (value: Date) => void;
  placeholder?: string;
  withTime?: boolean;
  minuteStep?: number;
  filled?: boolean;
  size?: "md" | "sm";
  label?: string;
  min?: Date;
  icon?: V3IconName | null;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<Date>(() => value ?? roundToStep(new Date(), minuteStep));
  const [month, setMonth] = useState(() => startOfMonth(value ?? new Date()));
  const calendarRef = useContentMotion<HTMLDivElement>(month.toISOString());
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const next = value ?? roundToStep(new Date(), minuteStep);
    setDraft(next);
    setMonth(startOfMonth(next));
  }, [open, value, minuteStep]);

  const days = calendarDays(month);
  const today = new Date();
  const hours = Array.from({ length: 24 }, (_, hour) => ({ value: pad(hour), label: pad(hour) }));
  const minutes = Array.from({ length: Math.floor(60 / minuteStep) }, (_, index) => ({ value: pad(index * minuteStep), label: pad(index * minuteStep) }));

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`v3-select${filled ? " is-filled" : ""}${size === "sm" ? " is-sm" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((next) => !next)}
      >
        {icon && <Icon name={icon} size={14} style={{ color: "var(--v3-sub)", flex: "0 0 auto" }} />}
        <span className={`v3-select-value v3-num${value ? "" : " is-placeholder"}`}>{value ? formatDateTimeLabel(value, withTime) : placeholder}</span>
        <Icon className="v3-select-chev" name="chevd" size={12} />
      </button>
      <Popover anchorRef={buttonRef} open={open} onClose={close} className="v3-picker" label={label ?? t("选择日期")}>
        <div className="v3-picker-head">
          <button type="button" className="v3-icon-btn" aria-label={t("上个月")} onClick={() => setMonth(addMonths(month, -1))}><Icon name="chevl" size={14} /></button>
          <strong className="v3-num">{month.getFullYear()}{t(" 年 ")}{month.getMonth() + 1}{t(" 月")}</strong>
          <button type="button" className="v3-icon-btn" aria-label={t("下个月")} onClick={() => setMonth(addMonths(month, 1))}><Icon name="chev" size={14} /></button>
        </div>
        <div ref={calendarRef} className="v3-picker-grid">
          {WEEK.map((day) => <span key={day}>{day}</span>)}
          {days.map((day) => {
            const selected = sameDay(day, draft);
            const disabled = Boolean(min && endOfDay(day) < min);
            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={disabled}
                className={`v3-picker-day${day.getMonth() !== month.getMonth() ? " is-muted" : ""}${sameDay(day, today) ? " is-today" : ""}${selected ? " is-selected" : ""}`}
                onClick={() => {
                  const next = new Date(draft);
                  next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
                  setDraft(next);
                  if (!withTime) {
                    onChange(next);
                    setOpen(false);
                  }
                }}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
        {withTime && (
          <>
            <div className="v3-picker-time">
              <Icon name="clock" size={14} />
              <span>{t("时间")}</span>
              <Select size="sm" label={t("小时")} value={pad(draft.getHours())} options={hours} onChange={(hour) => { const next = new Date(draft); next.setHours(Number(hour)); setDraft(next); }} />
              <span>:</span>
              <Select size="sm" label={t("分钟")} value={pad(draft.getMinutes() - (draft.getMinutes() % minuteStep))} options={minutes} onChange={(minute) => { const next = new Date(draft); next.setMinutes(Number(minute)); setDraft(next); }} />
            </div>
            <div className="v3-picker-foot">
              <button type="button" className="v3-btn v3-btn-ghost is-sm" onClick={() => setOpen(false)}>{t("取消")}</button>
              <button type="button" className="v3-btn v3-btn-dark is-sm" onClick={() => { onChange(draft); setOpen(false); }}>{t("确定")}</button>
            </div>
          </>
        )}
      </Popover>
    </>
  );
}

/** 跳转日期用的月历：选中某天后回调；range 用来高亮当前正在看的一周 / 一月。 */
export function MiniCalendar({
  value,
  onPick,
  range,
}: {
  value: Date;
  onPick: (day: Date) => void;
  range?: { start: Date; end: Date };
}) {
  useLocale();
  const [month, setMonth] = useState(() => startOfMonth(value));
  const calendarRef = useContentMotion<HTMLDivElement>(month.toISOString());
  useEffect(() => { setMonth(startOfMonth(value)); }, [value]);
  const today = new Date();
  const inRange = (day: Date) => Boolean(range && day >= range.start && day < range.end);
  return (
    <div className="v3-mini-calendar">
      <div className="v3-picker-head">
        <button type="button" className="v3-icon-btn" aria-label={t("上个月")} onClick={() => setMonth(addMonths(month, -1))}><Icon name="chevl" size={14} /></button>
        <strong className="v3-num" aria-live="polite">{month.getFullYear()}{t(" 年 ")}{month.getMonth() + 1}{t(" 月")}</strong>
        <button type="button" className="v3-icon-btn" aria-label={t("下个月")} onClick={() => setMonth(addMonths(month, 1))}><Icon name="chev" size={14} /></button>
      </div>
      <div ref={calendarRef} className="v3-picker-grid">
        {WEEK.map((day) => <span key={day}>{day}</span>)}
        {calendarDays(month).map((day) => (
          <button
            key={day.toISOString()}
            type="button"
            aria-label={t("{value0} 年 {value1} 月 {value2} 日", { value0: day.getFullYear(), value1: day.getMonth() + 1, value2: day.getDate() })}
            aria-pressed={sameDay(day, value)}
            className={`v3-picker-day${day.getMonth() !== month.getMonth() ? " is-muted" : ""}${sameDay(day, today) ? " is-today" : ""}${inRange(day) ? " is-in-range" : ""}${sameDay(day, value) ? " is-selected" : ""}`}
            onClick={() => onPick(day)}
          >
            {day.getDate()}
          </button>
        ))}
      </div>
      <div className="v3-mini-calendar-foot">
        <button type="button" className="v3-link" onClick={() => onPick(new Date(today.getFullYear(), today.getMonth(), today.getDate()))}>{t("回到今天")}</button>
      </div>
    </div>
  );
}

/**
 * 按周选择：每一行是一个按钮；选中的周画成一条胶囊（首尾两天实心，中间浅底），
 * 悬停时整行浅底；今天用数字下方的小圆点标出。「本周」放在页头箭头中间，和日历页头的「今天」一致。
 * onPick 收到该周周一。
 */
export function WeekCalendar({ value, onPick }: { value: Date; onPick: (weekStart: Date) => void }) {
  useLocale();
  const [month, setMonth] = useState(() => startOfMonth(value));
  const calendarRef = useContentMotion<HTMLDivElement>(month.toISOString());
  useEffect(() => { setMonth(startOfMonth(value)); }, [value]);
  const today = new Date();
  const thisWeek = startOfWeekMonday(today);
  const selectedWeek = startOfWeekMonday(value);
  const days = calendarDays(month);
  // 只显示和本月有交集的周（5 或 6 行），不画整行都是下个月的空周
  const weeks = Array.from({ length: 6 }, (_, index) => days.slice(index * 7, index * 7 + 7))
    .filter((week) => week.some((day) => day.getMonth() === month.getMonth()));
  const md = (day: Date) => t("{value0} 月 {value1} 日", { value0: day.getMonth() + 1, value1: day.getDate() });
  return (
    <div className="v3-mini-calendar v3-week-picker">
      <div className="v3-picker-head">
        <strong className="v3-num" aria-live="polite">{month.getFullYear()}{t(" 年 ")}{month.getMonth() + 1}{t(" 月")}</strong>
        <div className="v3-picker-nav">
          <button type="button" className="v3-icon-btn" aria-label={t("上个月")} onClick={() => setMonth(addMonths(month, -1))}><Icon name="chevl" size={14} /></button>
          <button type="button" className="v3-picker-today" disabled={sameDay(selectedWeek, thisWeek)} onClick={() => onPick(thisWeek)}>{t("本周")}</button>
          <button type="button" className="v3-icon-btn" aria-label={t("下个月")} onClick={() => setMonth(addMonths(month, 1))}><Icon name="chev" size={14} /></button>
        </div>
      </div>
      <div className="v3-week-picker-row is-head" aria-hidden="true">
        {WEEK.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div ref={calendarRef} className="v3-week-picker-rows">
        {weeks.map((week) => {
          const start = week[0];
          const end = week[6];
          const selected = sameDay(start, selectedWeek);
          return (
            <button
              key={start.toISOString()}
              type="button"
              className={`v3-week-picker-row${selected ? " is-selected" : ""}${sameDay(start, thisWeek) ? " is-current" : ""}`}
              aria-label={t("{value0} 年 {value1} – {value2}", { value0: start.getFullYear(), value1: md(start), value2: md(end) })}
              aria-pressed={selected}
              onClick={() => onPick(start)}
            >
              <span className="v3-week-picker-band">
                {week.map((day) => (
                  <span
                    key={day.getTime()}
                    className={`v3-week-picker-day v3-num${day.getMonth() !== month.getMonth() ? " is-muted" : ""}${sameDay(day, today) ? " is-today" : ""}`}
                  >
                    {day.getDate()}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 按月选择：一年 12 个月；「本月」放在页头箭头中间。onPick 收到该月 1 日 */
export function MonthCalendar({ value, onPick }: { value: Date; onPick: (monthStart: Date) => void }) {
  useLocale();
  const [year, setYear] = useState(() => value.getFullYear());
  const calendarRef = useContentMotion<HTMLDivElement>(String(year));
  useEffect(() => { setYear(value.getFullYear()); }, [value]);
  const today = new Date();
  const isThisMonth = value.getFullYear() === today.getFullYear() && value.getMonth() === today.getMonth();
  return (
    <div className="v3-mini-calendar v3-month-picker">
      <div className="v3-picker-head">
        <strong className="v3-num" aria-live="polite">{year}{t(" 年")}</strong>
        <div className="v3-picker-nav">
          <button type="button" className="v3-icon-btn" aria-label={t("上一年")} onClick={() => setYear(year - 1)}><Icon name="chevl" size={14} /></button>
          <button type="button" className="v3-picker-today" disabled={isThisMonth} onClick={() => onPick(new Date(today.getFullYear(), today.getMonth(), 1))}>{t("本月")}</button>
          <button type="button" className="v3-icon-btn" aria-label={t("下一年")} onClick={() => setYear(year + 1)}><Icon name="chev" size={14} /></button>
        </div>
      </div>
      <div ref={calendarRef} className="v3-picker-months">
        {Array.from({ length: 12 }, (_, index) => {
          const selected = value.getFullYear() === year && value.getMonth() === index;
          const current = today.getFullYear() === year && today.getMonth() === index;
          return (
            <button
              key={index}
              type="button"
              className={`v3-picker-month${current ? " is-today" : ""}${selected ? " is-selected" : ""}`}
              aria-label={t("{value0} 年 {value1} 月", { value0: year, value1: index + 1 })}
              aria-pressed={selected}
              onClick={() => onPick(new Date(year, index, 1))}
            >
              <span className="v3-num">{index + 1}</span>{t(" 月")}</button>
          );
        })}
      </div>
    </div>
  );
}

function startOfWeekMonday(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}
function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function roundToStep(date: Date, step: number) {
  const next = new Date(date);
  next.setSeconds(0, 0);
  next.setMinutes(Math.ceil(next.getMinutes() / step) * step);
  return next;
}
function calendarDays(month: Date) {
  const first = startOfMonth(month);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

/* ───────────────────────── 弹窗 ───────────────────────── */

export function Dialog(props: ComponentProps<typeof DialogSurface>) {
  useLocale();
  return <MotionPresence>{props.open !== false && <DialogSurface {...props} />}</MotionPresence>;
}

function DialogSurface({
  open = true,
  onClose,
  width,
  label,
  className = "",
  children,
  closable = true,
  showCloseButton = true,
}: {
  open?: boolean;
  onClose: () => void;
  width: number;
  label: string;
  className?: string;
  children: ReactNode;
  closable?: boolean;
  showCloseButton?: boolean;
}) {
  useLocale();
  const dialogRef = useRef<HTMLDivElement>(null);
  const present = useExitPresence(dialogRef);
  // onClose 存进 ref：调用方每次渲染传新函数时，不重新执行下面的聚焦逻辑（否则焦点会被抢回第一个元素）
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open || !present) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const focusable = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>("input, textarea, button:not(.v3-dialog-close)");
    focusable?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closable) onCloseRef.current();
      if (event.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, closable, present]);
  if (!open) return null;
  return createPortal(
    // 弹窗挂在 body 下，拿不到外壳上的浅色主题；这里补上，否则系统深色模式下里面的日期选择等控件会变黑
    <div className="v3 v3-overlay ui-motion-overlay" data-ui-theme="light" data-state={present ? "open" : "closed"} inert={!present || undefined} aria-hidden={!present || undefined} onMouseDown={(event) => { if (present && event.target === event.currentTarget && closable) onClose(); }}>
      <div ref={dialogRef} className={`v3-dialog ui-motion-dialog ${className}`} data-state={present ? "open" : "closed"} role="dialog" aria-modal="true" aria-label={label} style={{ width }}>
        {closable && showCloseButton && (
          <button type="button" className="v3-dialog-close" aria-label={t("关闭")} onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

// 居中确认弹窗（删除 / 退出 / 解绑）：插图 → 标题 → 说明 → 两个等宽按钮
export function ConfirmDialog({
  title,
  description,
  art,
  confirmLabel,
  busyLabel,
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  description: ReactNode;
  art?: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  useLocale();
  return (
    <Dialog width={420} label={title} onClose={onCancel} className="v3-confirm" closable={!busy}>
      <div className="v3-dialog-body">
        {art && <div className="v3-stage has-dots">{art}</div>}
        <h2 className="v3-dialog-title">{title}</h2>
        <div className="v3-dialog-sub">{description}</div>
        {children}
      </div>
      <div className="v3-confirm-foot">
        <button type="button" className="v3-btn v3-btn-ghost" disabled={busy} onClick={onCancel}>{t("取消")}</button>
        <button type="button" className={`v3-btn ${danger ? "v3-btn-danger" : "v3-btn-dark"}`} disabled={busy} onClick={onConfirm} data-autofocus>
          {busy ? busyLabel ?? t("处理中…") : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function DialogFooter({ left, children }: { left?: ReactNode; children?: ReactNode }) {
  useLocale();
  return (
    <div className="v3-dialog-foot">
      <div className="v3-dialog-foot-left">{left}</div>
      {children}
    </div>
  );
}

/* ───────────────────────── 小件 ───────────────────────── */

/**
 * 页面标题上方的小字（统一按「简历模板」页的样式）：英文模块名 · 当前位置 / 摘要，灰色 11px。
 * 例：TEMPLATES · 85 套、SCHEDULE · 2026 年、MOCK INTERVIEW · 练习记录。
 * 子页面把上级做成可点的链接段（onClick），点击回到上级；读屏按「页面位置」朗读。
 */
export type EyebrowLink = { label: ReactNode; onClick: () => void; href?: string; ariaLabel?: string };
export type EyebrowSegment = ReactNode | EyebrowLink;

export function PageEyebrow({ segments, className = "" }: { segments: EyebrowSegment[]; className?: string }) {
  useLocale();
  const items = segments.filter((segment) => segment !== null && segment !== undefined && segment !== false && segment !== "");
  return (
    <p className={`v3-page-eyebrow ${className}`}>
      {items.map((segment, index) => (
        <span key={index} className="v3-eyebrow-seg">
          {index > 0 && <span className="v3-eyebrow-sep" aria-hidden="true"> · </span>}
          {isLinkSegment(segment) ? (
            segment.href ? (
              // 有地址时用真正的链接：支持新标签页打开；普通点击走站内导航
              <a
                className="v3-eyebrow-link"
                href={segment.href}
                aria-label={segment.ariaLabel}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  segment.onClick();
                }}
              >
                {segment.label}
              </a>
            ) : (
              <button type="button" className="v3-eyebrow-link" aria-label={segment.ariaLabel} onClick={segment.onClick}>{segment.label}</button>
            )
          ) : segment}
        </span>
      ))}
    </p>
  );
}

function isLinkSegment(segment: EyebrowSegment): segment is EyebrowLink {
  return typeof segment === "object" && segment !== null && !isValidElement(segment) && "onClick" in (segment as object);
}


export function BeTag({ title = "需要后端支持，目前为示例数据" }: { title?: string }) {
  useLocale();
  return <span className="v3-be-tag" title={title}>{t("需后端")}</span>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string; disabled?: boolean }>; onChange: (value: T) => void; label?: string }) {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const update = () => {
      const selected = node.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (!selected) { setIndicator(null); return; }
      const next = { left: selected.offsetLeft, width: selected.offsetWidth };
      setIndicator((old) => old?.left === next.left && old.width === next.width ? old : next);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [value, options]);
  return (
    <div ref={root} className={`v3-seg${indicator?.width ? " has-indicator" : ""}`} role="group" aria-label={label}>
      {indicator && <span className="v3-seg-indicator" aria-hidden="true" style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }} />}
      {options.map((option) => (
        <button key={option.value} type="button" disabled={option.disabled} aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  useLocale();
  return <button type="button" role="switch" className="v3-toggle" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function SearchBox({ value, onChange, placeholder, width, label }: { value: string; onChange: (value: string) => void; placeholder: string; width?: number; label?: string }) {
  useLocale();
  return (
    <label className="v3-search" style={width ? { width } : undefined}>
      <Icon name="search" size={14} />
      <input type="search" value={value} placeholder={placeholder} aria-label={label ?? placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  useLocale();
  return (
    <span className="v3-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {src ? <img src={src} alt="" /> : [...(name || t("我"))][0]}
    </span>
  );
}

export function Toast({ title, message, kind = "info", onDismiss, action }: { title: string; message?: string; kind?: "info" | "error" | "warn" | "success"; onDismiss: () => void; action?: ReactNode }) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const present = useExitPresence(ref);
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);
  const color = kind === "error" ? "var(--v3-rd)" : kind === "warn" ? "var(--v3-or)" : kind === "success" ? "var(--v3-gn)" : "var(--v3-txt)";
  return createPortal(
    <div ref={ref} className="v3 v3-toast ui-motion-popover" data-ui-theme="light" data-state={present ? "open" : "closed"} inert={!present || undefined} aria-hidden={!present || undefined} role={kind === "error" ? "alert" : "status"}>
      <Icon name={kind === "success" ? "check" : "alert"} size={16} style={{ color, flex: "0 0 auto", marginTop: 1 }} />
      <div style={{ flex: 1 }}>
        <strong>{title}</strong>
        {message && <small>{message}</small>}
      </div>
      {action}
    </div>,
    document.body,
  );
}
