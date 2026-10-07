/* Lightweight charts for the admin console: bars, stacked bars, donut, heatmap, ranking bars. */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { formatCompact } from "./kit";

/**
 * Categorical slots for composition donuts, validated with the dataviz palette checker (CVD-safe on
 * the light surface). Orange and gold sit below 3:1, so every donut ships a legend with values.
 * Assign by entity in a fixed order; never cycle past the fifth slot (fold the rest into "其他").
 */
export const SERIES_COLORS = ["#4f6bd6", "#dd7a3e", "#8468cf", "#23a07a", "#c99a1c"] as const;
export const OTHER_COLOR = "#c9cac5";
export const STATUS_COLORS = { ok: "#2f9461", bad: "#c25b56", info: "#5972d9", warn: "#b7792e", idle: "#c9cac5", neutral: "#b9bab5" } as const;

export type DonutSlice = { key: string; label: string; value: number; color: string; display?: ReactNode };

function arcPath(cx: number, cy: number, r: number, ir: number, start: number, end: number) {
  const point = (radius: number, angle: number) => `${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)}`;
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${point(r, start)} A ${r} ${r} 0 ${large} 1 ${point(r, end)} L ${point(ir, end)} A ${ir} ${ir} 0 ${large} 0 ${point(ir, start)} Z`;
}

/** Slice angles with a small surface gap between neighbours; tiny slices keep a visible minimum. */
export function donutArcs(values: number[], gap = 0.022): Array<[number, number] | null> {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  const nonZero = values.filter((value) => value > 0).length;
  let angle = -Math.PI / 2;
  return values.map((value) => {
    if (value <= 0 || total <= 0) return null;
    const sweep = (value / total) * Math.PI * 2;
    const start = angle;
    angle += sweep;
    if (nonZero === 1) return [start, start + Math.PI * 2 - 0.0001];
    return [start + gap, start + Math.max(sweep - gap, gap * 2.4)];
  });
}

/** Composition ring (Figma V4 09/02/10/11): slices + a centred headline; the legend is rendered by the caller. */
export function Donut({ slices, size = 148, center, sub, ariaLabel }: { slices: DonutSlice[]; size?: number; center: ReactNode; sub?: ReactNode; ariaLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const arcs = donutArcs(slices.map((slice) => slice.value));
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const r = size / 2;
  const active = slices.find((slice) => slice.key === hover);
  return (
    <figure className="adm-donut" style={{ width: size, height: size }} aria-label={ariaLabel} role="img">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {total === 0 && <circle cx={r} cy={r} r={r * 0.88} fill="none" stroke="#f1f1ee" strokeWidth={r * 0.24} />}
        {slices.map((slice, index) => {
          const arc = arcs[index];
          if (!arc) return null;
          return (
            <path
              key={slice.key}
              d={arcPath(r, r, r, r * 0.7, arc[0], arc[1])}
              fill={slice.color}
              className={hover && hover !== slice.key ? "is-dim" : undefined}
              style={{ "--adm-i": index } as CSSProperties}
              onMouseEnter={() => setHover(slice.key)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>
      <figcaption className="adm-donut-center">
        {active ? (
          <><strong>{total ? `${((active.value / total) * 100).toFixed(1)}%` : "—"}</strong><small>{active.label}</small></>
        ) : (
          <><strong>{center}</strong>{sub && <small>{sub}</small>}</>
        )}
      </figcaption>
    </figure>
  );
}

/** Legend beside a donut: dot · label · value · share. `stacked` puts the value under the label (Figma 02/10). */
export function DonutLegend({ slices, stacked = false }: { slices: DonutSlice[]; stacked?: boolean }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const share = (value: number) => (total ? `${((value / total) * 100).toFixed(1)}%` : "—");
  return (
    <ul className={`adm-donut-legend${stacked ? " is-stacked" : ""}`}>
      {slices.map((slice) => (
        <li key={slice.key}>
          <span className="adm-donut-key"><i style={{ background: slice.color }} aria-hidden="true" />{slice.label}</span>
          {stacked ? (
            <span className="adm-donut-figure"><b>{slice.display ?? slice.value.toLocaleString("en-US")}</b><small>{share(slice.value)}</small></span>
          ) : (
            <><small>{slice.display ?? slice.value.toLocaleString("en-US")}</small><b>{share(slice.value)}</b></>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Thin bars on a baseline with sparse axis labels (Figma V4 02 新增用户, 01 趋势, 04 导入). */
/**
 * `ramp` (Figma V4 01 LLM 调用): full-width columns 10px apart, dark bars fading in from 25% to 89% opacity
 * towards today, today in the accent colour, and labels centred under their own column.
 */
export function ThinBars({ data, height = 132, barWidth = 12, ariaLabel, highlightLast = true, ramp = false, fadeTo = 0.89, hideAxis = false }: { data: BarDatum[]; height?: number; barWidth?: number; ariaLabel: string; highlightLast?: boolean; ramp?: boolean; fadeTo?: number; hideAxis?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((item) => item.value));
  const ticks = data.length <= 7 ? data.map((_, index) => index) : [0, Math.floor(data.length / 2), data.length - 1];
  return (
    <figure className={`adm-thin${ramp ? " is-ramp" : ""}`} aria-label={ariaLabel}>
      <div className="adm-thin-plot" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((item, index) => {
          const share = item.value / max;
          const fade = ramp ? 0.25 + (fadeTo - 0.25) * (data.length > 2 ? index / (data.length - 2) : 1) : undefined;
          return (
            <div
              key={item.key}
              className={`adm-thin-col${hover === index ? " is-hover" : ""}`}
              style={{ "--adm-i": index, "--adm-share": share } as CSSProperties}
              tabIndex={0}
              aria-label={`${item.label} ${item.value}`}
              onMouseEnter={() => setHover(index)}
              onFocus={() => setHover(index)}
              onBlur={() => setHover(null)}
            >
              <i className={`adm-thin-bar${highlightLast && index === data.length - 1 ? " is-current" : ""}`} style={{ width: ramp ? undefined : barWidth, height: `${Math.max(item.value > 0 ? 2 : 0, share * 100)}%`, "--adm-fade": fade } as CSSProperties} />
              {hover === index && (
                <div className="adm-tooltip is-thin" role="tooltip">{item.tooltip ?? <><small>{item.label}</small><strong>{item.value.toLocaleString("en-US")}</strong></>}</div>
              )}
            </div>
          );
        })}
      </div>
      {!hideAxis && <div className={`adm-thin-axis${data.length <= 7 || ramp ? " is-every" : ""}`} aria-hidden="true">
        {data.length <= 7 ? data.map((item) => <span key={item.key}>{item.label}</span>)
          : ramp ? data.map((item, index) => <span key={item.key}>{ticks.includes(index) ? item.label : ""}</span>)
          : ticks.map((index) => <span key={index}>{data[index]?.label}</span>)}
      </div>}
    </figure>
  );
}

export type ThinStackSeries = { key: string; label: string; color: string };

/** Thin stacked bars (Figma V4 10 每日运行结果): 16px columns, 2px gaps between segments. */
export function ThinStackedBars({ data, series, height = 132, ariaLabel }: { data: StackDatum[]; series: ThinStackSeries[]; height?: number; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((item) => series.reduce((sum, entry) => sum + (item.values[entry.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <figure className="adm-thin" aria-label={ariaLabel}>
      <div className="adm-thin-plot" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((item, index) => (
          <div
            key={item.key}
            className={`adm-thin-col${hover === index ? " is-hover" : ""}`}
            style={{ "--adm-i": index, "--adm-share": totals[index] / max } as CSSProperties}
            tabIndex={0}
            aria-label={`${item.label} ${series.map((entry) => `${entry.label} ${item.values[entry.key] ?? 0}`).join("，")}`}
            onMouseEnter={() => setHover(index)}
            onFocus={() => setHover(index)}
            onBlur={() => setHover(null)}
          >
            <span className="adm-thin-stack" style={{ height: `${(totals[index] / max) * 100}%` }}>
              {series.slice().reverse().map((entry) => (item.values[entry.key] ?? 0) > 0 && (
                <i key={entry.key} style={{ flexGrow: item.values[entry.key], background: entry.color }} />
              ))}
            </span>
            {hover === index && (
              <div className="adm-tooltip is-thin" role="tooltip">
                <small>{item.label}</small>
                {series.map((entry) => (
                  <span key={entry.key} className="adm-tooltip-row"><i className="adm-dot" style={{ background: entry.color }} />{entry.label}<b>{item.values[entry.key] ?? 0}</b></span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="adm-thin-axis is-every" aria-hidden="true">{data.map((item) => <span key={item.key}>{item.label}</span>)}</div>
    </figure>
  );
}

export function DotLegend({ items }: { items: Array<{ key: string; label: string; color: string }> }) {
  return (
    <ul className="adm-legend">
      {items.map((item) => <li key={item.key}><i className="adm-dot" style={{ background: item.color }} />{item.label}</li>)}
    </ul>
  );
}

/** Axis top for three equal steps of a "nice" size (Figma uses 0 / 4K / 8K / 12K). */
export function niceMax(value: number): number {
  if (value <= 0) return 3;
  // Counts never need fractional ticks.
  const rawStep = Math.max(1, value / 3);
  const exponent = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 4, 5, 10].map((candidate) => candidate * exponent).find((candidate) => candidate >= rawStep) ?? 10 * exponent;
  return step * 3;
}

export type BarDatum = { key: string; label: string; value: number; tooltip?: ReactNode };

/** One measure over time; every 3rd label is shown so ticks never collide. */
export function BarChart({ data, height = 196, highlightLast = true, ariaLabel }: { data: BarDatum[]; height?: number; highlightLast?: boolean; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => niceMax(Math.max(0, ...data.map((item) => item.value))), [data]);
  const ticks = [0, 1, 2, 3].map((step) => (max / 3) * step);
  const labelEvery = data.length > 16 ? 5 : 3;
  return (
    <figure className="adm-chart" style={{ height }} aria-label={ariaLabel}>
      <div className="adm-chart-grid" aria-hidden="true">
        {ticks.slice().reverse().map((tick, index) => (
          <div key={tick} className={index === ticks.length - 1 ? "is-base" : undefined}><span>{formatCompact(Math.round(tick))}</span></div>
        ))}
      </div>
      <div className="adm-chart-plot" onMouseLeave={() => setHover(null)}>
        {data.map((item, index) => {
          const last = highlightLast && index === data.length - 1;
          const showLabel = index % labelEvery === 0 || index === data.length - 1;
          const share = (item.value / max) * 100;
          return (
            <div
              key={item.key}
              className={`adm-bar-col${hover === index ? " is-hover" : ""}`}
              style={{ "--adm-i": index, "--adm-share": share / 100 } as CSSProperties}
              onMouseEnter={() => setHover(index)}
              onFocus={() => setHover(index)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${item.label} ${item.value}`}
            >
              <i className={`adm-bar${last ? " is-current" : ""}`} style={{ height: `${share}%` }} />
              {last && item.value > 0 && <b className="adm-bar-value">{formatCompact(item.value)}</b>}
              <span className={`adm-bar-label${showLabel ? "" : " is-hidden"}`}>{item.label}</span>
              {hover === index && (
                <div className="adm-tooltip" role="tooltip">
                  {item.tooltip ?? <><small>{item.label}</small><strong>{item.value.toLocaleString("en-US")}</strong></>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export type StackSeries = { key: string; label: string; tone: "ok" | "info" | "bad" };
export type StackDatum = { key: string; label: string; values: Record<string, number> };

export function StackedBarChart({ data, series, height = 180, ariaLabel }: { data: StackDatum[]; series: StackSeries[]; height?: number; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((item) => series.reduce((sum, entry) => sum + (item.values[entry.key] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const ticks = [0, 1, 2, 3].map((step) => (max / 3) * step);
  return (
    <figure className="adm-chart" style={{ height }} aria-label={ariaLabel}>
      <div className="adm-chart-grid" aria-hidden="true">
        {ticks.slice().reverse().map((tick, index) => (
          <div key={tick} className={index === ticks.length - 1 ? "is-base" : undefined}><span>{formatCompact(Math.round(tick))}</span></div>
        ))}
      </div>
      <div className="adm-chart-plot is-wide" onMouseLeave={() => setHover(null)}>
        {data.map((item, index) => (
          <div key={item.key} className={`adm-bar-col${hover === index ? " is-hover" : ""}`} style={{ "--adm-i": index, "--adm-share": totals[index] / max } as CSSProperties} onMouseEnter={() => setHover(index)} tabIndex={0} onFocus={() => setHover(index)} onBlur={() => setHover(null)} aria-label={`${item.label} ${series.map((entry) => `${entry.label} ${item.values[entry.key] ?? 0}`).join("，")}`}>
            <div className="adm-stack" style={{ height: `${(totals[index] / max) * 100}%` }}>
              {series.slice().reverse().map((entry) => (item.values[entry.key] ?? 0) > 0 && (
                <i key={entry.key} className={`adm-stack-seg adm-fill-${entry.tone}`} style={{ flexGrow: item.values[entry.key] }} />
              ))}
            </div>
            <span className="adm-bar-label">{item.label}</span>
            {hover === index && (
              <div className="adm-tooltip" role="tooltip">
                <small>{item.label}</small>
                {series.map((entry) => (
                  <span key={entry.key} className="adm-tooltip-row"><i className={`adm-dot adm-dot-${entry.tone}`} />{entry.label}<b>{item.values[entry.key] ?? 0}</b></span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </figure>
  );
}

export function Legend({ series }: { series: StackSeries[] }) {
  return (
    <ul className="adm-legend">
      {series.map((entry) => <li key={entry.key}><i className={`adm-legend-swatch adm-fill-${entry.tone}`} />{entry.label}</li>)}
    </ul>
  );
}

export type HeatCell = { start: string; error: number; warn: number };

const weekdayShort = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const HEAT_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

/**
 * 7 local days × 8 three-hour buckets (Figma 346:1012). Buckets are placed by local
 * date and hour, so a window that does not start at midnight still yields 7 rows.
 */
export function heatRows(buckets: HeatCell[], now = new Date()) {
  const byKey = new Map<string, HeatCell>();
  for (const bucket of buckets) {
    const date = new Date(bucket.start);
    const slot = Math.floor(date.getHours() / 3);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${slot}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, error: existing.error + bucket.error, warn: existing.warn + bucket.warn } : bucket);
  }
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - offset));
    const isToday = offset === 6;
    return {
      key: day.toDateString(),
      label: isToday ? "今天" : weekdayShort[day.getDay()],
      date: `${day.getMonth() + 1}/${day.getDate()}`,
      isToday,
      cells: HEAT_HOURS.map((hour, slot) => {
        const cell = byKey.get(`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}-${slot}`);
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
        return { key: start.toISOString(), hour, error: cell?.error ?? 0, warn: cell?.warn ?? 0, future: start > now };
      }),
    };
  });
}

/** Error-weighted intensity, 0–5 to match the six-step Figma ramp. */
function heatLevel(error: number, warn: number, max: number) {
  const score = error * 3 + warn;
  if (score === 0) return 0;
  return Math.min(5, Math.ceil((score / max) * 5));
}

export function Heatmap({ buckets }: { buckets: HeatCell[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const rows = useMemo(() => heatRows(buckets), [buckets]);
  const max = Math.max(1, ...rows.flatMap((row) => row.cells.map((cell) => cell.error * 3 + cell.warn)));
  return (
    <div className="adm-heatmap" role="grid" aria-label="错误与警告分布">
      <div className="adm-heat-row adm-heat-axis" aria-hidden="true">
        <span />
        {HEAT_HOURS.map((hour) => <span key={hour}>{String(hour).padStart(2, "0")}</span>)}
      </div>
      {rows.map((row, rowIndex) => (
        <div key={row.key} className="adm-heat-row" role="row">
          <span className={`adm-heat-day${row.isToday ? " is-today" : ""}`} role="rowheader" title={row.date}>{row.label}</span>
          {row.cells.map((cell, cellIndex) => {
            const label = `${row.date} ${String(cell.hour).padStart(2, "0")}:00 · 错误 ${cell.error} · 警告 ${cell.warn}`;
            return (
              <span
                key={cell.key}
                role="gridcell"
                tabIndex={cell.future ? -1 : 0}
                aria-label={cell.future ? `${row.date} ${String(cell.hour).padStart(2, "0")}:00 · 尚未到达` : label}
                className={`adm-heat-cell adm-heat-${heatLevel(cell.error, cell.warn, max)}${cell.future ? " is-future" : ""}`}
                style={{ "--adm-i": rowIndex * 8 + cellIndex } as CSSProperties}
                onMouseEnter={() => !cell.future && setHover(cell.key)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(cell.key)}
                onBlur={() => setHover(null)}
              >
                {hover === cell.key && <span className="adm-tooltip is-heat" role="tooltip"><small>{row.label} {row.date} · {String(cell.hour).padStart(2, "0")}:00</small><span className="adm-tooltip-row"><i className="adm-dot adm-dot-bad" />错误<b>{cell.error}</b></span><span className="adm-tooltip-row"><i className="adm-dot adm-dot-warn" />警告<b>{cell.warn}</b></span></span>}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function HeatLegend() {
  return (
    <span className="adm-heat-legend" aria-hidden="true">少{[0, 1, 2, 3, 4, 5].map((step) => <i key={step} className={`adm-heat-${step}`} />)}多</span>
  );
}

/** Horizontal ranking (Figma 346:585): 190px label, 14px track, value + note on the right. The leader is highlighted. */
export function RankBars({ items }: { items: Array<{ key: string; label: ReactNode; value: number; note?: ReactNode; mark?: ReactNode }> }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ol className="adm-rank">
      {items.map((item, index) => (
        <li key={item.key} style={{ "--adm-i": index } as CSSProperties}>
          <span className="adm-rank-label">{item.mark}<span>{item.label}</span></span>
          <span className="adm-rank-track"><i className={index === 0 ? "is-lead" : undefined} style={{ width: `${(item.value / max) * 100}%` }} /></span>
          <span className="adm-rank-value"><b>{item.value.toLocaleString("en-US")}</b>{item.note && <small>{item.note}</small>}</span>
        </li>
      ))}
    </ol>
  );
}
