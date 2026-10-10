// 本地选项匹配，不发送网络请求。
// 顺序：精确 → 归一化相等 → 同义词组 → 包含关系 → 二元组相似度。

const ALIAS_GROUPS = [
  ['本科', '大学本科', '学士', '本科生', 'Bachelor'],
  ['硕士', '硕士研究生', '研究生', '硕士生', 'Master'],
  ['博士', '博士研究生', '博士生', 'PhD', 'Doctor'],
  ['大专', '专科', '高职', '大学专科'],
  ['男', '男性', 'Male'],
  ['女', '女性', 'Female'],
  ['中国', '中国大陆', '中华人民共和国', 'China'],
  ['汉族', '汉'],
  ['中共党员', '党员', '中国共产党党员'],
  ['中共预备党员', '预备党员'],
  ['共青团员', '团员'],
  ['群众', '普通群众'],
  ['是', 'Yes', '有'],
  ['否', 'No', '无'],
  ['身份证', '居民身份证', '中华人民共和国居民身份证', '大陆身份证'],
  ['未婚', '单身'],
  ['已婚', '已婚已育', '已婚未育'],
];

// 去空白、全角转半角、统一大小写，去掉“（选填）”和常见行政区后缀以外的括号说明。
export function normalize(text) {
  return String(text ?? '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/\s+/g, '')
    .replace(/\((选填|必填|可选)\)/g, '')
    .toLowerCase();
}

function aliasKey(text) {
  const n = normalize(text);
  const group = ALIAS_GROUPS.findIndex((g) => g.some((a) => normalize(a) === n));
  return group === -1 ? null : group;
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

export function similarity(a, b) {
  a = normalize(a);
  b = normalize(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) || 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/**
 * 从候选文本中选出与目标值最匹配的一项。
 * @param {string[]} candidates
 * @param {string} target
 * @param {{ threshold?: number }} [opts]
 * @returns {string | null} 命中的候选原文；没有足够把握时返回 null，交给调用方标记待处理。
 */
export function pickOption(candidates, target, { threshold = 0.5 } = {}) {
  if (!candidates?.length || target == null || target === '') return null;
  if (candidates.includes(target)) return target;
  const t = normalize(target);
  const exact = candidates.find((c) => normalize(c) === t);
  if (exact) return exact;

  const key = aliasKey(target);
  if (key != null) {
    const alias = candidates.find((c) => aliasKey(c) === key);
    if (alias) return alias;
  }

  // 包含关系：如“北京大学”对“北京大学（本部）”，取多余字符最少的一项。
  let contained = null;
  let extra = Infinity;
  for (const c of candidates) {
    const n = normalize(c);
    if (!n) continue;
    if (n.includes(t) || (t.includes(n) && n.length >= 2)) {
      const diff = Math.abs(n.length - t.length);
      if (diff < extra) [extra, contained] = [diff, c];
    }
  }
  if (contained) return contained;

  let best = null;
  let score = 0;
  for (const c of candidates) {
    const s = similarity(c, target);
    if (s > score) [score, best] = [s, c];
  }
  return score >= threshold ? best : null;
}

// 级联值拆成逐级路径，如“广东省/深圳市/南山区”。
export function splitPath(value) {
  return String(value ?? '')
    .split(/[\\/>\-\s、]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 下拉里只剩一项且是占位提示时视为无结果，避免把“无锡”等有效选项误判为空。
const EMPTY_TEXTS = ['暂无数据', '暂无', 'No data', '未找到', '未查询到', '无匹配数据', '无数据', '无', '没有'];
export function isEmptyOptionText(text) {
  const t = String(text ?? '').trim();
  return EMPTY_TEXTS.some((e) => t === e) || /^(暂无|未找到|未查询到|没有)/.test(t);
}
