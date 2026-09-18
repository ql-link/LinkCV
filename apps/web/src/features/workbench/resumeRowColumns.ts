/**
 * 等分栏的栏宽计算。编辑器、正反向投影和打印渲染器共用同一套规则，
 * 因此单独成模块，避免渲染侧依赖编辑器命令。
 */

/** 等分栏每栏的最小宽度占比，和后端契约保持一致。 */
export const RESUME_ROW_MIN_COLUMN_WIDTH = 10;

const RESUME_ROW_WIDTH_SUM_TOLERANCE = 0.01;

/**
 * 校验并归一化栏宽：长度必须等于栏数，每栏不低于最小宽度，总和为一整行。
 * 任何不合法的输入都退回等分（返回 null）。
 */
export function normalizeResumeRowColumnWidths(
  value: unknown,
  count: number,
): number[] | null {
  if (!Array.isArray(value) || count < 3 || value.length !== count) return null;
  const widths = value.map((item) => Number(item));
  if (widths.some((width) => !Number.isFinite(width))) return null;
  const ceiling = 100 - RESUME_ROW_MIN_COLUMN_WIDTH * (count - 1);
  if (
    widths.some(
      (width) => width < RESUME_ROW_MIN_COLUMN_WIDTH || width > ceiling,
    )
  ) {
    return null;
  }
  const sum = widths.reduce((total, width) => total + width, 0);
  if (Math.abs(sum - 100) > RESUME_ROW_WIDTH_SUM_TOLERANCE) return null;
  // 逐项取两位小数会让总和偏离 100，超过契约容差后保存会被拒绝，
  // 因此让最后一项吸收舍入误差，保证总和恰好是一整行。
  const leading = widths
    .slice(0, -1)
    .map((width) => Number(width.toFixed(2)));
  const trailing = Number(
    (100 - leading.reduce((total, width) => total + width, 0)).toFixed(2),
  );
  const normalized = [...leading, trailing];
  if (
    normalized.some(
      (width) => width < RESUME_ROW_MIN_COLUMN_WIDTH || width > ceiling,
    )
  ) {
    return null;
  }
  return normalized;
}

/**
 * 拖动一条分隔线：只让它左右相邻的两栏此消彼长，两栏之和不变，其余栏原样保留。
 * 两侧都夹在最小宽度内，因此不会把某一栏拖没。
 */
export function resizeResumeRowColumns(
  widths: number[],
  dividerIndex: number,
  deltaPercent: number,
): number[] {
  const next = [...widths];
  const left = next[dividerIndex];
  const right = next[dividerIndex + 1];
  if (left == null || right == null) return next;
  const pairTotal = left + right;
  const min = RESUME_ROW_MIN_COLUMN_WIDTH;
  // 先夹取再取整；取整后若另一侧不足最小宽度，就把这一侧让回去，
  // 保证两栏之和不变且两侧都不低于最小宽度。
  let leftNext = Number(
    Math.min(pairTotal - min, Math.max(min, left + deltaPercent)).toFixed(2),
  );
  let rightNext = Number((pairTotal - leftNext).toFixed(2));
  if (rightNext < min) {
    rightNext = min;
    leftNext = Number((pairTotal - min).toFixed(2));
  }
  next[dividerIndex] = leftNext;
  next[dividerIndex + 1] = rightNext;
  return next;
}

/** 某一行的等分宽度，用于没有自定义宽度时的分隔线位置与基准值。 */
export function equalResumeRowColumnWidths(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

/** 把栏宽换算成网格轨道；比例关系用 fr，网格间距由容器自身处理。 */
export function resumeRowColumnTracks(widths: number[]): string {
  return widths.map((width) => `${width}fr`).join(" ");
}

/** 每条分隔线距行左边的百分比位置。 */
export function resumeRowDividerOffsets(widths: number[]): number[] {
  return widths
    .slice(0, -1)
    .map((_, index) => widths
      .slice(0, index + 1)
      .reduce((total, width) => total + width, 0));
}
