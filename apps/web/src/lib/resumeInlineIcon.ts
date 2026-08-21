export const resumeInlineIconOptions = [
  { name: "Mail", label: "邮箱", keywords: ["邮件"] },
  { name: "Phone", label: "电话", keywords: ["手机"] },
  { name: "MapPin", label: "地点", keywords: ["地址", "城市"] },
  { name: "Globe", label: "网站", keywords: ["主页"] },
  { name: "Github", label: "GitHub", keywords: ["代码仓库"] },
  { name: "Linkedin", label: "LinkedIn", keywords: ["领英"] },
  { name: "GraduationCap", label: "学校", keywords: ["教育", "学历"] },
  { name: "Briefcase", label: "工作", keywords: ["经历", "职位"] },
  { name: "Award", label: "荣誉", keywords: ["奖项", "证书"] },
  { name: "Star", label: "重点", keywords: ["星标"] },
  { name: "Calendar", label: "日期", keywords: ["时间"] },
  { name: "Code2", label: "代码", keywords: ["技术", "开发"] },
] as const;

export type InlineIconName = typeof resumeInlineIconOptions[number]["name"];

const inlineIconNames = new Set<string>(resumeInlineIconOptions.map((option) => option.name));

export const resumeInlineIconGlyphs: Record<InlineIconName, string> = {
  Mail: "✉",
  Phone: "☎",
  MapPin: "●",
  Globe: "◎",
  Github: "◆",
  Linkedin: "◇",
  GraduationCap: "学",
  Briefcase: "■",
  Award: "★",
  Star: "★",
  Calendar: "□",
  Code2: "〈〉",
};

export function isInlineIconName(value: unknown): value is InlineIconName {
  return typeof value === "string" && inlineIconNames.has(value);
}

export function inlineIconMarkdown(name: InlineIconName) {
  return `[[linkcv-icon:${name}]]`;
}
