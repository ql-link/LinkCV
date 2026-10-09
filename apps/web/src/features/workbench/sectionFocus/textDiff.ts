export type DiffSegment = { kind: "same" | "add" | "del"; text: string };

const MAX_CELLS = 400_000;

/**
 * Character-level diff (longest common subsequence). Resume lines are short, so
 * the quadratic table is fine; very long inputs fall back to "all replaced".
 */
export function diffText(before: string, after: string): DiffSegment[] {
  if (before === after) return before ? [{ kind: "same", text: before }] : [];
  const a = [...before];
  const b = [...after];
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    return [
      ...(before ? [{ kind: "del" as const, text: before }] : []),
      ...(after ? [{ kind: "add" as const, text: after }] : []),
    ];
  }
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const segments: DiffSegment[] = [];
  const push = (kind: DiffSegment["kind"], char: string) => {
    const last = segments[segments.length - 1];
    if (last?.kind === kind) last.text += char;
    else segments.push({ kind, text: char });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      push("del", a[i]);
      i += 1;
    } else {
      push("add", b[j]);
      j += 1;
    }
  }
  while (i < a.length) push("del", a[i++]);
  while (j < b.length) push("add", b[j++]);
  return mergeNoise(segments);
}

/**
 * Single shared characters between two edits (e.g. a lone「的」) make the
 * highlight look like confetti; fold them into the surrounding change.
 */
function mergeNoise(segments: DiffSegment[]): DiffSegment[] {
  const result: DiffSegment[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const prev = segments[index - 1];
    const next = segments[index + 1];
    if (segment.kind === "same" && [...segment.text].length <= 1 && prev && next && prev.kind !== "same" && next.kind !== "same") {
      result.push({ kind: "del", text: segment.text }, { kind: "add", text: segment.text });
      continue;
    }
    result.push({ ...segment });
  }
  // Re-group so each run of changes reads as「删掉的」then「新增的」.
  const grouped: DiffSegment[] = [];
  let dels = "";
  let adds = "";
  const flush = () => {
    if (dels) grouped.push({ kind: "del", text: dels });
    if (adds) grouped.push({ kind: "add", text: adds });
    dels = "";
    adds = "";
  };
  for (const segment of result) {
    if (segment.kind === "del") dels += segment.text;
    else if (segment.kind === "add") adds += segment.text;
    else {
      flush();
      grouped.push(segment);
    }
  }
  flush();
  return grouped;
}

/** Offsets of added text inside `after`, for highlighting the applied line. */
export function addedRanges(before: string, after: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  for (const segment of diffText(before, after)) {
    if (segment.kind === "del") continue;
    const length = segment.text.length;
    if (segment.kind === "add" && segment.text.trim()) ranges.push([offset, offset + length]);
    offset += length;
  }
  return ranges;
}
