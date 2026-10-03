/* Shared building blocks for the admin console (Figma 7PoM4KgpvOsZfeawHgtoob · V4 page 566:2). */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, Info, MoreHorizontal, Search, X, type LucideIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiRequestError, type CostSummary } from "../../api/client";
import { visualScale } from "./viewportScale";

/* ---------- formatting ---------- */

export const useCaseLabels: Record<string, string> = {
  assistant_conversation: "用户对话",
  resume_structuring: "简历结构化",
  job_text_extraction: "职位文本提取",
  job_image_extraction: "职位图片识别",
  mock_interview: "模拟面试",
  transcript_correction: "识别稿修正",
  job_match: "简历匹配度",
  interview_prep: "面试准备清单",
  recording_transcription: "面试录音文件转写",
  speech_to_text: "语音识别",
  text_to_speech: "语音合成",
};

export const useCaseLabel = (code: string) => useCaseLabels[code] ?? code;

export function parseTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  // Some legacy endpoints return naive UTC timestamps.
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const pad = (value: number) => String(value).padStart(2, "0");

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

/** "今天 16:42" / "昨天 09:10" / "9/26 22:10" / "2025/9/26". */
export function formatWhen(value: string | null | undefined, fallback = "—", { compact = false } = {}): string {
  const date = parseTime(value);
  if (!date) return fallback;
  const now = new Date();
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  // Log tables drop "今天" so a column of today's rows reads as plain times (Figma 346:782).
  if (sameDay(date, now)) return compact ? clock : `今天 ${clock}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `昨天 ${clock}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}/${date.getDate()} ${clock}`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatDateTime(value: string | null | undefined, fallback = "—"): string {
  const date = parseTime(value);
  if (!date) return fallback;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDate(value: string | null | undefined, fallback = "—"): string {
  const date = parseTime(value);
  if (!date) return fallback;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const shortWeekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** "2026-09-23" → "9/23 周二" (chart tooltips). */
export function formatDayLabel(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${month}/${day} ${shortWeekdays[new Date(year, month - 1, day).getDay()]}`;
}

export const formatNumber = (value: number | null | undefined) =>
  value == null ? "—" : value.toLocaleString("en-US");

export function formatCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(value);
}

export const formatPercent = (value: number | null | undefined, digits = 1) =>
  value == null ? "—" : `${(value * 100).toFixed(digits)}%`;

export function formatMs(value: number | null | undefined): string {
  if (value == null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

const currencySymbols: Record<string, string> = { USD: "$", CNY: "¥" };

export function formatMoney(amount: string | number, currency: string | null | undefined): string {
  const value = Number(amount);
  const symbol = currency ? currencySymbols[currency] : undefined;
  const digits = Math.abs(value) > 0 && Math.abs(value) < 0.01 ? 4 : 2;
  const text = Number.isFinite(value) ? value.toFixed(digits) : String(amount);
  return symbol ? `${symbol}${text}` : `${text} ${currency ?? ""}`.trim();
}

/** Multi-currency totals are shown side by side; nothing is converted. */
export function formatCosts(summary: CostSummary | null | undefined): string {
  if (!summary || summary.costs.length === 0) return "—";
  return summary.costs.map((entry) => formatMoney(entry.amount, entry.currency)).join(" + ");
}

/** Relative change string from the insights API ("0.124" → "+12.4%"). */
export function formatDelta(value: string | null | undefined): { text: string; tone: Tone } | null {
  if (value == null) return null;
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return null;
  const text = `${ratio > 0 ? "+" : ""}${(ratio * 100).toFixed(1)}%`;
  return { text, tone: ratio > 0 ? "ok" : ratio < 0 ? "bad" : "muted" };
}

export function errorCode(error: unknown, fallback = "REQUEST_FAILED"): string {
  if (error instanceof ApiRequestError) return error.message || fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Local datetime-local value ↔ ISO string. */
export function toLocalInput(value: string | null | undefined): string {
  const date = parseTime(value);
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * One search box for "调用 ID / 用户 ID / 错误码": all digits is a user ID, an UPPER_SNAKE code
 * is an error code, anything else is an exact record ID. Every result is an exact backend filter.
 */
export function parseRecordSearch(value: string): { kind: "user" | "error" | "id"; value: string } | null {
  const text = value.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return { kind: "user", value: text };
  if (/^[A-Z][A-Z0-9_]+$/.test(text)) return { kind: "error", value: text };
  return { kind: "id", value: text };
}

/* ---------- console context ---------- */

type ConsoleContext = {
  notify: (message: string, kind?: "success" | "error") => void;
  onSessionExpired: () => void;
  navigate: (path: string) => void;
};

const AdminConsoleContext = createContext<ConsoleContext>({
  notify: () => undefined,
  onSessionExpired: () => undefined,
  navigate: () => undefined,
});

export const AdminConsoleProvider = AdminConsoleContext.Provider;
export const useConsole = () => useContext(AdminConsoleContext);

/** Loads once on mount and on `reload()`; 401 hands the session back to the shell. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const { onSessionExpired } = useConsole();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const sequence = useRef(0);

  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current();
      if (current === sequence.current) setData(result);
      return result;
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 401) onSessionExpired();
      if (current === sequence.current) setError(errorCode(caught));
      return null;
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => { void reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, setData, error, loading, reload };
}

/* ---------- layout ---------- */

export function PageHeader({ title, meta, hint, actions }: { title: ReactNode; meta?: ReactNode; hint?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="adm-page-header">
      <div className="adm-page-title">
        <h1>{title}</h1>
        {hint && <span className="adm-page-hint">{hint}</span>}
        {actions && <div className="adm-page-actions">{actions}</div>}
      </div>
      {meta && <p className="adm-page-meta">{meta}</p>}
    </header>
  );
}

export function Section({ title, meta, aside, children, className }: { title?: ReactNode; meta?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`adm-section${className ? ` ${className}` : ""}`}>
      {(title || aside) && (
        <div className="adm-section-head">
          <div className="adm-section-title">
            {title && <h2>{title}</h2>}
            {meta && <span>{meta}</span>}
          </div>
          {aside && <div className="adm-section-aside">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = "ok" | "bad" | "warn" | "info" | "neutral" | "muted";

/** Tinted backgrounds for icon chips (Figma V4: blue / violet / amber / green / red / neutral). */
export type Tint = "blue" | "violet" | "amber" | "green" | "red" | "gray";

/** Icon on a pale rounded square; identifies a metric, feed item or block. */
export function Chip({ icon: Icon, tint = "gray", size = 36 }: { icon: LucideIcon; tint?: Tint; size?: number }) {
  return (
    <span className={`adm-chip-icon adm-tint-${tint}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }} aria-hidden="true">
      <Icon size={Math.round(size / 2)} strokeWidth={2} />
    </span>
  );
}

/** Vendor / provider mark: a white tile with a coloured initial. */
/** White tile with a brand mark; falls back to the coloured initial when no mark is known. */
export function Logo({ letter, color = "#454842", size = 20, icon }: { letter: string; color?: string; size?: number; icon?: string | null }) {
  return (
    <span className={`adm-logo${icon ? " has-icon" : ""}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), color, fontSize: Math.max(9, Math.round(size * 0.52)) }} aria-hidden="true">
      {icon ? <img src={icon} alt="" width={Math.round(size * 0.64)} height={Math.round(size * 0.64)} draggable={false} /> : letter.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function IconButton({ icon: Icon, label, tone = "muted", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; tone?: "muted" | "bad" }) {
  return (
    <button
      type="button"
      className={`adm-icon-btn is-${tone}${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
      {...props}
      onClick={(event) => { event.stopPropagation(); props.onClick?.(event); }}
    >
      <Icon size={15} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

/** Faint one-line note at the foot of a page (Figma V4 shield / alert footnotes). */
export function Footnote({ icon: Icon = Info, children }: { icon?: LucideIcon; children: ReactNode }) {
  return <p className="adm-footnote"><Icon size={13} strokeWidth={2} aria-hidden="true" />{children}</p>;
}

export type MoreMenuItem = { label: string; icon?: LucideIcon; onSelect: () => void; tone?: "bad"; disabled?: boolean };

/** "⋯" overflow for low-frequency row actions, so rows keep one or two visible controls. */
export function MoreMenu({ label, items, disabled }: { label: string; items: MoreMenuItem[]; disabled?: boolean }) {
  return (
    <DropdownPrimitive.Root modal={false}>
      <DropdownPrimitive.Trigger className="adm-icon-btn" aria-label={label} title={label} disabled={disabled} onClick={(event) => event.stopPropagation()}>
        <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
      </DropdownPrimitive.Trigger>
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content className="adm-select-content adm-menu" align="end" sideOffset={6} collisionPadding={12}>
          {items.map((item) => (
            <DropdownPrimitive.Item key={item.label} className={`adm-select-item${item.tone === "bad" ? " is-bad" : ""}`} disabled={item.disabled} onSelect={item.onSelect}>
              <span className="adm-menu-label">{item.icon && <item.icon size={14} strokeWidth={2} aria-hidden="true" />}{item.label}</span>
            </DropdownPrimitive.Item>
          ))}
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  );
}

export type MetricItem = { label: string; value: ReactNode; note?: ReactNode; tone?: Tone; onClick?: () => void; icon?: LucideIcon; tint?: Tint };

export function Metrics({ items, label = "核心指标" }: { items: MetricItem[]; label?: string }) {
  return (
    <div className="adm-metrics" role="group" aria-label={label}>
      {items.map((item) => {
        const body = (
          <>
            {item.icon && <Chip icon={item.icon} tint={item.tint} />}
            <span className="adm-metric-body">
              <span className="adm-metric-label">{item.label}</span>
              <span className="adm-metric-value">
                <strong>{item.value}</strong>
                {item.note != null && <em className={`adm-tone-${item.tone ?? "muted"}`}>{item.note}</em>}
              </span>
            </span>
          </>
        );
        return item.onClick ? (
          <button key={item.label} type="button" className="adm-metric is-link" onClick={item.onClick}>{body}</button>
        ) : (
          <div key={item.label} className="adm-metric">{body}</div>
        );
      })}
    </div>
  );
}

export function Summary({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="adm-summary">
      {items.map((item) => (
        <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>
      ))}
    </dl>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="adm-note">{children}</p>;
}

/* ---------- atoms ---------- */

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`adm-badge adm-badge-${tone}`}>{children}</span>;
}

export function StatusDot({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className="adm-status"><i className={`adm-dot adm-dot-${tone}`} aria-hidden="true" />{children}</span>;
}

export function Avatar({ label, color, size = "sm" }: { label: string; color?: string; size?: "xs" | "sm" | "md" | "lg" }) {
  return <span className={`adm-avatar is-${size}`} style={color ? { background: color } : undefined} aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`adm-toggle${checked ? " is-on" : ""}`}
      disabled={disabled}
      onClick={(event) => { event.stopPropagation(); onChange(!checked); }}
    >
      <span />
    </button>
  );
}

export function Button({
  variant = "secondary",
  children,
  className,
  dismiss = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; dismiss?: boolean }) {
  const close = useContext(DismissContext);
  const onClick = dismiss && close ? (event: React.MouseEvent<HTMLButtonElement>) => { props.onClick?.(event); close(); } : props.onClick;
  return <button type="button" className={`adm-btn adm-btn-${variant}${className ? ` ${className}` : ""}`} {...props} onClick={onClick}>{children}</button>;
}

export function LinkButton({ tone = "info", children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "info" | "bad" | "muted" }) {
  return (
    <button
      type="button"
      className={`adm-link adm-link-${tone}${className ? ` ${className}` : ""}`}
      {...props}
      onClick={(event) => { event.stopPropagation(); props.onClick?.(event); }}
    >
      {children}
    </button>
  );
}

/**
 * Positions a shared indicator (segmented thumb, tab underline) under the active child by writing
 * its offset and width to CSS variables; CSS transitions do the sliding.
 */
function useActiveIndicator<T extends HTMLElement>(selector: string, deps: unknown[]) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const place = () => {
      const active = root.querySelector<HTMLElement>(selector);
      if (!active) { root.style.setProperty("--adm-ind-w", "0px"); return; }
      root.style.setProperty("--adm-ind-x", `${active.offsetLeft}px`);
      root.style.setProperty("--adm-ind-w", `${active.offsetWidth}px`);
    };
    place();
    // Labels such as tab counts can change width after data arrives.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(root);
    return () => observer?.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  const ref = useActiveIndicator<HTMLDivElement>('button[aria-pressed="true"]', [value, options.length]);
  return (
    <div ref={ref} className="adm-segmented" role="group" aria-label={label}>
      <i className="adm-segmented-thumb" aria-hidden="true" />
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (value: T) => void; label: string }) {
  const ref = useActiveIndicator<HTMLDivElement>('button[aria-selected="true"]', [value, options.length]);
  return (
    <div ref={ref} className="adm-tabs" role="tablist" aria-label={label}>
      <i className="adm-tabs-ink" aria-hidden="true" />
      {options.map((option) => (
        <button key={option.value} type="button" role="tab" aria-selected={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Filter tabs drawn as plain text with a count (Figma V4 "Text Tabs"); the active one is bold. */
export function TextTabs<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string; count?: number | string | null }>; onChange: (value: T) => void; label: string }) {
  return (
    <div className="adm-text-tabs" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="tab" aria-selected={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
          {option.count != null && <>{" "}<b>{typeof option.count === "number" ? option.count.toLocaleString("en-US") : option.count}</b></>}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, onSubmit, width }: { value: string; onChange: (value: string) => void; placeholder: string; onSubmit?: () => void; width?: number }) {
  return (
    <label className="adm-search" style={width ? { width } : undefined}>
      <Search size={14} aria-hidden="true" />
      <input
        type="search"
        value={value}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && onSubmit) { event.preventDefault(); onSubmit(); } }}
      />
    </label>
  );
}

// Radix Select reserves "" for "no value", so empty options (e.g. "全部状态") travel under a sentinel.
const EMPTY_OPTION = "__adm_empty__";

/** Custom-rendered dropdown (Radix Select) styled to the V3 console; replaces the native <select>. */
export function SelectBox<T extends string>({ value, options, onChange, label, className, disabled, icon: Icon }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string; className?: string; disabled?: boolean; icon?: LucideIcon }) {
  const encode = (item: string) => (item === "" ? EMPTY_OPTION : item);
  return (
    <SelectPrimitive.Root value={encode(value)} onValueChange={(next) => onChange((next === EMPTY_OPTION ? "" : next) as T)} disabled={disabled}>
      <SelectPrimitive.Trigger className={`adm-select${Icon ? " has-icon" : ""}${className ? ` ${className}` : ""}`} aria-label={label}>
        {Icon && <Icon size={14} strokeWidth={2} className="adm-select-lead" aria-hidden="true" />}
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon className="adm-select-icon"><ChevronDown size={14} strokeWidth={2} aria-hidden="true" /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="adm-select-content" position="popper" sideOffset={6} collisionPadding={12}>
          <SelectPrimitive.Viewport className="adm-select-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item key={option.value} value={encode(option.value)} className="adm-select-item">
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="adm-select-check"><Check size={14} strokeWidth={2.2} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="adm-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <small className="adm-field-error" role="alert">{error}</small> : hint ? <small>{hint}</small> : null}
    </div>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return <p className="adm-inline-error" role="alert">{children}</p>;
}

/* ---------- drag reorder ---------- */

/** Index of the slot under the pointer, or the closest one when it is between cards. */
export function nearestSlot(slots: DOMRect[], x: number, y: number): number | null {
  if (!slots.length) return null;
  let best = 0;
  let bestDistance = Infinity;
  slots.forEach((rect, index) => {
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) { bestDistance = distance; best = index; }
  });
  return best;
}

/**
 * FLIP: call `capture()` right before a state change that reorders children;
 * after React commits, every moved `[data-<attr>]` child animates from its old spot.
 */
export function useFlip(container: React.RefObject<HTMLElement | null>, attr = "flip") {
  const selector = `[data-${attr.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}]`;
  const before = useRef<Map<string, DOMRect> | null>(null);
  useLayoutEffect(() => {
    const previous = before.current;
    before.current = null;
    const root = container.current;
    if (!previous || !root || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    root.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      const from = previous.get(node.dataset[attr]!);
      if (!from) return;
      const to = node.getBoundingClientRect();
      // Rects are on-screen px; the transform is in the node's own (possibly zoomed) px.
      const scale = visualScale(node);
      const dx = (from.left - to.left) / scale;
      const dy = (from.top - to.top) / scale;
      if (!dx && !dy) return;
      node.animate?.([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2, .8, .2, 1)" });
    });
  });
  return {
    capture() {
      const root = container.current;
      if (!root) return;
      before.current = new Map([...root.querySelectorAll<HTMLElement>(selector)].map((node) => [node.dataset[attr]!, node.getBoundingClientRect()]));
    },
  };
}

/** Insertion index for a vertical list: how many of the other items have their middle above the pointer. */
export function insertionIndex(mids: number[], y: number): number {
  return mids.filter((mid) => mid < y).length;
}

/**
 * Layout middles (client Y) of `container`'s `[data-<attr>]` items, skipping `skipKey`. Uses offsetTop
 * rather than getBoundingClientRect so a running FLIP transform cannot shift the targets; the container
 * must be positioned. Items of different heights work because the dragged item's own slot moves with it.
 */
export function layoutMids(container: HTMLElement, items: HTMLElement[], skip: (node: HTMLElement) => boolean): number[] {
  const top = container.getBoundingClientRect().top;
  // offsetTop is layout px; the pointer's clientY is on-screen px, so convert under viewport zoom.
  const scale = visualScale(container);
  return items.filter((node) => !skip(node)).map((node) => {
    let offset = 0;
    for (let current: HTMLElement | null = node; current && current !== container; current = current.offsetParent as HTMLElement | null) offset += current.offsetTop;
    return top + (offset + node.offsetHeight / 2) * scale;
  });
}

/* ---------- tables ---------- */

export type Column<T> = { key: string; label: ReactNode; width?: string; align?: "right"; render: (row: T) => ReactNode };

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowLabel,
  empty = "暂无数据",
  headless = false,
  className,
  busy = false,
  setKey: setKeyOverride,
  rowAttrs,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  empty?: ReactNode;
  headless?: boolean;
  className?: string;
  /** Dims the current rows while a filter or page change is loading the next set. */
  busy?: boolean;
  /** Identity of the row set; defaults to the row keys. Lists that append ("加载更多") pass their query instead. */
  setKey?: string;
  /** Extra class and data attributes per row, e.g. drag placeholders and FLIP keys. */
  rowAttrs?: (row: T) => { className?: string } & { [key: `data-${string}`]: string | undefined };
}) {
  const template = columns.map((column) => column.width ?? "minmax(0, 1fr)").join(" ");
  // A different set of rows (filter, tab, page) re-keys the body so the rows animate in;
  // in-place edits of the same rows (toggles, renames) keep their identity and do not replay.
  const setKey = setKeyOverride ?? rows.map(rowKey).join("|");
  return (
    <div className={`adm-table${className ? ` ${className}` : ""}${busy ? " is-busy" : ""}`} role="table" aria-busy={busy || undefined}>
      {!headless && (
        <div className="adm-tr adm-thead" role="row" style={{ gridTemplateColumns: template }}>
          {columns.map((column) => <span key={column.key} role="columnheader" className={column.align === "right" ? "is-right" : undefined}>{column.label}</span>)}
        </div>
      )}
      <div className="adm-tbody" role="rowgroup" key={setKey}>
      {rows.length === 0 ? (
        <div className="adm-table-empty" role="row"><span role="cell">{empty}</span></div>
      ) : rows.map((row, index) => {
        const { className: rowClass, ...attrs } = rowAttrs?.(row) ?? {};
        return (
        <div
          {...attrs}
          key={rowKey(row)}
          role="row"
          className={`adm-tr${onRowClick ? " is-clickable" : ""}${rowClass ? ` ${rowClass}` : ""}`}
          style={{ gridTemplateColumns: template, "--adm-i": Math.min(index, 12) } as React.CSSProperties}
          tabIndex={onRowClick ? 0 : undefined}
          aria-label={onRowClick && rowLabel ? rowLabel(row) : undefined}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={onRowClick ? (event) => {
            if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
              event.preventDefault();
              onRowClick(row);
            }
          } : undefined}
        >
          {columns.map((column) => <span key={column.key} role="cell" className={column.align === "right" ? "is-right" : undefined}>{column.render(row)}</span>)}
        </div>
        );
      })}
      </div>
    </div>
  );
}

export function TableFooter({ children }: { children: ReactNode }) {
  return <div className="adm-table-footer">{children}</div>;
}

/**
 * A page's main list that scrolls inside itself: the toolbar and footer stay put, the table header
 * sticks, and the panel fills the card's remaining height. When the content above leaves too little
 * room the panel keeps a minimum height and the whole page scrolls instead (see console.css).
 */
export function ListPanel({ toolbar, footer, children, label, resetKey }: { toolbar?: ReactNode; footer?: ReactNode; children: ReactNode; label?: string; resetKey?: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // A new filter, tab or page starts at the top of the list rather than wherever the last one was.
  useEffect(() => { bodyRef.current?.scrollTo?.({ top: 0 }); }, [resetKey]);
  return (
    <section className="adm-list-panel" aria-label={label}>
      {toolbar && <div className="adm-list-toolbar">{toolbar}</div>}
      <div ref={bodyRef} className="adm-list-body">{children}</div>
      {footer && <div className="adm-list-foot">{footer}</div>}
    </section>
  );
}

/* ---------- states & skeletons ---------- */

export function ErrorState({ title = "数据暂不可用", code, onRetry }: { title?: string; code?: string | null; onRetry?: () => void }) {
  return (
    <div className="adm-state" role="alert">
      <strong>{title}</strong>
      {code && <code>{code}</code>}
      {onRetry && <Button onClick={onRetry}>重试</Button>}
    </div>
  );
}

export function SkBar({ width, height = 8 }: { width: number | string; height?: number }) {
  return <i className="adm-sk" style={{ width, height }} aria-hidden="true" />;
}

export function SkeletonMetrics({ count = 4 }: { count?: number }) {
  return (
    <div className="adm-metrics" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="adm-metric"><SkBar width={36} height={36} /><span className="adm-metric-body"><SkBar width={56} /><SkBar width={84} height={16} /></span></div>
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 5, columns = 5, height = 52 }: { rows?: number; columns?: number; height?: number }) {
  return (
    <div className="adm-table" aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="adm-tr" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, minHeight: height }}>
          {Array.from({ length: columns }, (_, column) => <span key={column}><SkBar width={`${[72, 48, 60, 40, 54][(row + column) % 5]}%`} /></span>)}
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ height = 196 }: { height?: number }) {
  return (
    <div className="adm-sk-chart" style={{ height }} aria-hidden="true">
      {Array.from({ length: 14 }, (_, index) => <i key={index} className="adm-sk" style={{ height: `${30 + ((index * 37) % 55)}%` }} />)}
    </div>
  );
}

/** Screen-reader announcement for skeleton regions. */
export function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  return <div role="status" aria-label={label} aria-busy="true">{children}</div>;
}

/* ---------- overlays ---------- */

/**
 * Modals and drawers own their open flag so Radix can play the exit animation:
 * closing flips `open` to false, and the parent's onClose runs once the animation ends.
 * Buttons inside use `<Button dismiss>` to close through the same path.
 */
const DismissContext = createContext<(() => void) | null>(null);

const EXIT_FALLBACK_MS = 320;

function useAnimatedClose(onClose: () => void, busy = false) {
  const [open, setOpen] = useState(true);
  const closedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const finish = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCloseRef.current();
  }, []);
  const dismiss = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);
  useEffect(() => {
    if (open) return;
    // No animation runs under reduced motion or in jsdom; never leave the parent waiting.
    const timer = window.setTimeout(finish, EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [open, finish]);
  const onAnimationEnd = useCallback((event: React.AnimationEvent) => {
    if (!open && event.target === event.currentTarget) finish();
  }, [open, finish]);
  return { open, dismiss, onAnimationEnd };
}

export function Modal({
  title,
  eyebrow,
  subtitle,
  onClose,
  children,
  footer,
  width = 560,
  role = "dialog",
  busy = false,
}: {
  title: ReactNode;
  /** Small label above a detail title, e.g. "系统日志 · 日志详情" (Figma 526:573). */
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  role?: "dialog" | "alertdialog";
  busy?: boolean;
}) {
  const { open, dismiss, onAnimationEnd } = useAnimatedClose(onClose, busy);
  return (
    <DismissContext.Provider value={dismiss}>
      <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="adm-scrim" />
          <DialogPrimitive.Content className="adm-modal" role={role} style={{ width: `min(${width}px, calc(100vw - 32px))` }} aria-describedby={undefined} onAnimationEnd={onAnimationEnd}>
            <header className={`adm-modal-head${eyebrow ? " has-eyebrow" : ""}`}>
              <div>
                {eyebrow && <span className="adm-modal-eyebrow">{eyebrow}</span>}
                <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
                {subtitle && <p>{subtitle}</p>}
              </div>
              <DialogPrimitive.Close className="adm-close" aria-label="关闭" disabled={busy}><X size={16} /></DialogPrimitive.Close>
            </header>
            {children && <div className="adm-modal-body">{children}</div>}
            {footer && <footer className="adm-modal-foot">{footer}</footer>}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </DismissContext.Provider>
  );
}

export function ConfirmModal({
  title,
  children,
  confirmLabel,
  busyLabel = "处理中…",
  danger = false,
  busy,
  onCancel,
  onConfirm,
  width = 440,
}: {
  width?: number;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  danger?: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      title={title}
      role="alertdialog"
      width={width}
      busy={busy}
      onClose={onCancel}
      footer={(
        <>
          <Button dismiss disabled={busy}>取消</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>{busy ? busyLabel : confirmLabel}</Button>
        </>
      )}
    >
      <div className="adm-confirm-text">{children}</div>
    </Modal>
  );
}

export function Drawer({ title, eyebrow, subtitle, onClose, children, footer, width = 480 }: { title: ReactNode; eyebrow?: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const { open, dismiss, onAnimationEnd } = useAnimatedClose(onClose);
  return (
    <DismissContext.Provider value={dismiss}>
      <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="adm-scrim" />
          <DialogPrimitive.Content className="adm-drawer" style={{ width: `min(${width}px, calc(100vw))` }} aria-describedby={undefined} onAnimationEnd={onAnimationEnd}>
            <header className={`adm-modal-head${eyebrow ? " has-eyebrow" : ""}`}>
              <div>
                {eyebrow && <span className="adm-modal-eyebrow">{eyebrow}</span>}
                <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
                {subtitle && <div className="adm-drawer-subtitle">{subtitle}</div>}
              </div>
              <DialogPrimitive.Close className="adm-close" aria-label="关闭"><X size={16} /></DialogPrimitive.Close>
            </header>
            <div className="adm-drawer-body">{children}</div>
            {footer && <footer className="adm-modal-foot">{footer}</footer>}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </DismissContext.Provider>
  );
}

export function DetailList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="adm-detail-list">
      {items.filter(([, value]) => value !== null && value !== undefined && value !== "").map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

export function copyText(text: string, notify: ConsoleContext["notify"], label = "已复制") {
  navigator.clipboard?.writeText(text).then(
    () => notify(`${label}：${text}`),
    () => notify("复制失败", "error"),
  );
}
