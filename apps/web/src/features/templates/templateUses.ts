// 「x 使用」的写法：千以上写成 3.2k，千以下写原数（Figma 03.1：3.2k / 980）
export function formatTemplateUses(count: number) {
  if (count < 1000) return String(count);
  const value = Math.round(count / 100) / 10;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}k`;
}
