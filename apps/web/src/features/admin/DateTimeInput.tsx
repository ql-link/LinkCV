/* Custom-rendered date-time field for the admin console; replaces the native datetime-local picker. */
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const HOURS = Array.from({ length: 24 }, (_, index) => index);
/** The grid offers 5-minute steps; ArrowUp/Down on the minute segment reaches any exact minute. */
const MINUTES = Array.from({ length: 12 }, (_, index) => index * 5);

type Mode = "date" | "hour" | "minute";

const pad = (value: number) => String(value).padStart(2, "0");

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

/** Value keeps the datetime-local shape ("YYYY-MM-DDTHH:mm") so callers and fromLocalInput stay unchanged. */
function parse(value: string): Parts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  return { year, month: month - 1, day, hour, minute };
}

function format(parts: Parts) {
  return `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function dayLabel(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 6 weeks starting on Monday, so the grid height never jumps between months. */
function monthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => new Date(year, month, 1 - offset + index));
}

const sameDate = (date: Date, parts: { year: number; month: number; day: number }) =>
  date.getFullYear() === parts.year && date.getMonth() === parts.month && date.getDate() === parts.day;

export function DateTimeInput({
  id,
  value,
  onChange,
  label,
  placeholder = "选择日期与时间",
  defaultTime = "00:00",
  width,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Accessible name when the field has no visible <label htmlFor>. */
  label?: string;
  placeholder?: string;
  /** Time used when a day is picked while the field is still empty. */
  defaultTime?: string;
  width?: number;
}) {
  const parts = parse(value);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("date");
  const today = new Date();
  const [view, setView] = useState(() => ({ year: parts?.year ?? today.getFullYear(), month: parts?.month ?? today.getMonth() }));
  // Keyboard focus inside the grid (roving tabindex); starts on the selected day or today.
  const [focusDay, setFocusDay] = useState<Date>(() => (parts ? new Date(parts.year, parts.month, parts.day) : today));
  const gridRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  // Reopen on the month of the current value.
  useEffect(() => {
    if (!open) return;
    const current = parse(value);
    const base = current ? new Date(current.year, current.month, current.day) : new Date();
    setView({ year: base.getFullYear(), month: base.getMonth() });
    setFocusDay(base);
    setMode("date");
  }, [open]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>("button[tabindex='0']")?.focus();
  }, [focusDay]);

  const [defaultHour, defaultMinute] = defaultTime.split(":").map(Number);
  const commit = (next: Partial<Parts>) => {
    // An empty field starts from today (or the 1st of the month on screen) at the default time.
    const base: Parts = parts ?? (view.year === today.getFullYear() && view.month === today.getMonth()
      ? { year: view.year, month: view.month, day: today.getDate(), hour: defaultHour, minute: defaultMinute }
      : { year: view.year, month: view.month, day: 1, hour: defaultHour, minute: defaultMinute });
    onChange(format({ ...base, ...next }));
  };

  const pickDay = (date: Date) => {
    commit({ year: date.getFullYear(), month: date.getMonth(), day: date.getDate() });
    setFocusDay(date);
    if (date.getMonth() !== view.month) setView({ year: date.getFullYear(), month: date.getMonth() });
  };

  const shiftMonth = (delta: number) => {
    const next = new Date(view.year, view.month + delta, 1);
    setView({ year: next.getFullYear(), month: next.getMonth() });
  };

  const onGridKey = (event: KeyboardEvent) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const step = steps[event.key];
    if (step == null) return;
    event.preventDefault();
    const next = new Date(focusDay.getFullYear(), focusDay.getMonth(), focusDay.getDate() + step);
    moveFocus.current = true;
    setFocusDay(next);
    if (next.getMonth() !== view.month || next.getFullYear() !== view.year) setView({ year: next.getFullYear(), month: next.getMonth() });
  };

  const setNow = () => {
    const now = new Date();
    onChange(format({ year: now.getFullYear(), month: now.getMonth(), day: now.getDate(), hour: now.getHours(), minute: now.getMinutes() }));
    setView({ year: now.getFullYear(), month: now.getMonth() });
  };

  const hour = parts?.hour ?? defaultHour;
  const minute = parts?.minute ?? defaultMinute;
  const onSegmentKey = (unit: "hour" | "minute") => (event: KeyboardEvent) => {
    const step = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    if (unit === "hour") commit({ hour: (hour + step + 24) % 24, minute });
    else commit({ hour, minute: (minute + step + 60) % 60 });
  };

  const days = monthGrid(view.year, view.month);
  const focusInView = days.some((date) => date.getTime() === focusDay.getTime() && date.getMonth() === view.month);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        id={id}
        type="button"
        className={`adm-date-trigger${parts ? "" : " is-empty"}`}
        aria-label={label}
        style={width ? { width } : undefined}
      >
        <CalendarDays size={15} aria-hidden="true" />
        <span>{parts ? `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}` : placeholder}</span>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className="adm-select-content adm-date-pop" align="start" sideOffset={6} collisionPadding={12} aria-label={label ? `${label}选择器` : "日期时间选择器"}>
          <div className="adm-date-cal">
            {mode === "date" ? (
              <>
                <div className="adm-date-head">
                  <strong>{view.year} 年 {view.month + 1} 月</strong>
                  <span>
                    <button type="button" className="adm-date-nav" aria-label="上个月" onClick={() => shiftMonth(-1)}><ChevronLeft size={16} aria-hidden="true" /></button>
                    <button type="button" className="adm-date-nav" aria-label="下个月" onClick={() => shiftMonth(1)}><ChevronRight size={16} aria-hidden="true" /></button>
                  </span>
                </div>
                <div className="adm-date-week" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
                <div ref={gridRef} className="adm-date-grid" role="grid" aria-label={`${view.year} 年 ${view.month + 1} 月`} onKeyDown={onGridKey}>
                  {days.map((date, index) => {
                    const outside = date.getMonth() !== view.month;
                    const selected = parts ? sameDate(date, parts) : false;
                    const isToday = sameDate(date, { year: today.getFullYear(), month: today.getMonth(), day: today.getDate() });
                    // Roving tabindex: the focused day if it is in this month, otherwise the 1st.
                    const focusable = focusInView ? date.getTime() === focusDay.getTime() && !outside : !outside && date.getDate() === 1;
                    return (
                      <button
                        key={index}
                        type="button"
                        role="gridcell"
                        tabIndex={focusable ? 0 : -1}
                        aria-label={dayLabel(date)}
                        aria-selected={selected}
                        aria-current={isToday ? "date" : undefined}
                        className={`adm-date-day${outside ? " is-outside" : ""}${selected ? " is-selected" : ""}${isToday ? " is-today" : ""}`}
                        onClick={() => pickDay(date)}
                      >
                        {date.getDate()}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="adm-date-head">
                  <strong>{mode === "hour" ? "选择小时" : "选择分钟"}</strong>
                  <button type="button" className="adm-date-back" onClick={() => setMode("date")}><ChevronLeft size={14} aria-hidden="true" />日期</button>
                </div>
                <div className={`adm-time-grid is-${mode}`} role="listbox" aria-label={mode === "hour" ? "小时" : "分钟"}>
                  {(mode === "hour" ? HOURS : MINUTES).map((item) => {
                    const selected = parts != null && item === (mode === "hour" ? parts.hour : parts.minute);
                    return (
                      <button
                        key={item}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={selected ? "is-selected" : undefined}
                        // Hour → minute → back to the calendar, so a full time takes two clicks.
                        onClick={() => { if (mode === "hour") { commit({ hour: item }); setMode("minute"); } else { commit({ minute: item }); setMode("date"); } }}
                      >
                        {mode === "hour" ? pad(item) : `:${pad(item)}`}
                      </button>
                    );
                  })}
                  {mode === "minute" && <span className="adm-time-hint" aria-hidden="true">其他分钟：选中分钟框后按 ↑ ↓</span>}
                </div>
              </>
            )}
          </div>
          <div className="adm-time-bar">
            <span className="adm-time-label"><Clock3 size={14} aria-hidden="true" />时间</span>
            <span className={`adm-time-segs${parts ? "" : " is-empty"}`}>
              <button type="button" aria-label="选择小时" aria-pressed={mode === "hour"} className={mode === "hour" ? "is-active" : undefined} onClick={() => setMode(mode === "hour" ? "date" : "hour")} onKeyDown={onSegmentKey("hour")}>{pad(hour)}</button>
              <i aria-hidden="true">:</i>
              <button type="button" aria-label="选择分钟" aria-pressed={mode === "minute"} className={mode === "minute" ? "is-active" : undefined} onClick={() => setMode(mode === "minute" ? "date" : "minute")} onKeyDown={onSegmentKey("minute")}>{pad(minute)}</button>
            </span>
          </div>
          <div className="adm-date-foot">
            <button type="button" className="adm-link adm-link-info" onClick={setNow}>此刻</button>
            <span>
              <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" disabled={!parts} onClick={() => { onChange(""); setOpen(false); }}>清除</button>
              <button type="button" className="adm-btn adm-btn-primary adm-btn-sm" onClick={() => setOpen(false)}>完成</button>
            </span>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
