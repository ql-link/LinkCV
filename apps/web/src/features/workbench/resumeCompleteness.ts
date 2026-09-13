export type ResumeCompletenessStatus = "passed" | "partial" | "failed";

export type ResumeCompletenessCheck = {
  id: string;
  category: "basics" | "experience" | "education" | "skills" | "structure";
  label: string;
  status: ResumeCompletenessStatus;
  earnedPoints: number;
  maxPoints: number;
  issue?: string;
  recommendation?: string;
};

export type ResumeCompletenessCap = {
  id: "sample-identity" | "sample-content";
  maxScore: number;
  reason: string;
};

export type ResumeCompletenessResult = {
  score: number;
  rawScore: number;
  earnedPoints: number;
  maxPoints: 100;
  level: "待补充" | "基本完整" | "较完整" | "完整";
  checks: ResumeCompletenessCheck[];
  scoreCaps: ResumeCompletenessCap[];
};

export type ResumeCompletenessTone = "low" | "medium" | "high";

type MarkdownSection = {
  title: string;
  body: string;
};

const SAMPLE_IDENTITIES = ["张三"];
const SAMPLE_PHONE_DIGITS = "13800000000";
const SAMPLE_CONTENT_MARKERS = [
  "示例大学",
  "星河云科技有限公司",
  "青舟数据服务有限公司",
  "TaskFlow Lite",
];

const educationHeadingPattern = /(?:教育|学历|院校|education|academic)/iu;
const skillsHeadingPattern = /(?:技能|技术栈|技术能力|专业能力|核心能力|能力与专长|专长|skills?|technolog|competenc|expertise)/iu;
const experienceHeadingPattern = /(?:工作|实习|项目|开源|校园|研究|实践|任职|职业|experience|employment|work|projects?|intern|research)/iu;
const datePattern = /(?:19|20)\d{2}(?:\s*[./年-]\s*(?:0?[1-9]|1[0-2])月?)?|至今|现在|present|current/iu;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const phoneCandidatePattern = /(?:\+?\d[\d\s()-]{5,}\d)/gu;
const listItemPattern = /^\s*(?:[-*+]\s+|\d+[.)、]\s*)\S/u;
const listItemPrefixPattern = /^\s*(?:[-*+]\s+|\d+[.)、]\s*)/u;
const skillPlaceholderPattern = /^(?:无|暂无|没有|待补充|待完善|略|技能|专业技能|技术栈|技术能力|核心能力|熟练|精通|掌握|了解)[。.!！]?$/iu;
const genericSkillPattern = /^(?:沟通|学习|执行|抗压|适应|团队协作|责任心|认真负责|吃苦耐劳)(?:能力)?(?:强|良好|优秀)?[。.!！]?$/u;
const skillApplicationPattern = /(?:熟练|精通|掌握|了解|使用|应用|搭建|开发|设计|优化|测试|分析|运营|管理|写作|协作|项目|场景|经验|年|能够|可独立|负责|提升|降低|完成|支持)/iu;
const latinSkillPattern = /\b[A-Z][A-Z0-9.+#/-]{1,}\b/iu;
const multipleSkillConceptPattern = /(?:与|及|和|、|\/|\+|，|,|；|;)/u;

function visibleText(value: string) {
  return value
    .replace(/<!--.*?-->/gu, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>]+>/gu, " ")
    .replace(/:\w+\[[^\]]*\]:/gu, " ")
    .replace(/:::[^\r\n]*/gu, " ")
    .replace(/[*_~`>#|]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function parseMarkdown(markdown: string) {
  const lines = markdown.split(/\r?\n/gu);
  const h1: string[] = [];
  const h2Indexes: Array<{ index: number; title: string }> = [];
  let firstH1Index = -1;

  lines.forEach((line, index) => {
    const heading = /^(#{1,2})\s+(.+?)\s*$/u.exec(line.trim());
    if (!heading) return;
    const title = visibleText(heading[2]);
    if (heading[1] === "#") {
      h1.push(title);
      if (firstH1Index < 0) firstH1Index = index;
    } else {
      h2Indexes.push({ index, title });
    }
  });

  const sections: MarkdownSection[] = h2Indexes.map((heading, index) => ({
    title: heading.title,
    body: lines.slice(heading.index + 1, h2Indexes[index + 1]?.index ?? lines.length).join("\n"),
  }));
  const firstH2Index = h2Indexes[0]?.index ?? lines.length;
  const preamble = firstH1Index >= 0
    ? lines.slice(firstH1Index + 1, firstH2Index).join("\n")
    : lines.slice(0, firstH2Index).join("\n");

  return { h1, h2: h2Indexes.map((heading) => heading.title), preamble, sections };
}

function sectionKind(title: string) {
  if (educationHeadingPattern.test(title)) return "education" as const;
  if (skillsHeadingPattern.test(title)) return "skills" as const;
  if (experienceHeadingPattern.test(title)) return "experience" as const;
  return "other" as const;
}

function sectionsByKind(sections: MarkdownSection[], kind: "education" | "skills" | "experience") {
  return sections.filter((section) => sectionKind(section.title) === kind);
}

function recognizedPhoneNumbers(markdown: string) {
  return (markdown.match(phoneCandidatePattern) ?? [])
    .map((candidate) => candidate.replace(/\D/gu, ""))
    .filter((digits) => digits.length >= 7 && digits.length <= 15);
}

function hasPhone(markdown: string) {
  return recognizedPhoneNumbers(markdown).length > 0;
}

function check(
  id: string,
  category: ResumeCompletenessCheck["category"],
  label: string,
  earnedPoints: number,
  maxPoints: number,
  issue: string,
  recommendation: string,
): ResumeCompletenessCheck {
  return {
    id,
    category,
    label,
    earnedPoints,
    maxPoints,
    status: earnedPoints === maxPoints ? "passed" : earnedPoints > 0 ? "partial" : "failed",
    ...(earnedPoints === maxPoints ? {} : { issue, recommendation }),
  };
}

function hasMeaningfulIdentityLine(body: string) {
  return body.split(/\r?\n/gu).some((line) => {
    const text = visibleText(line);
    const textWithoutDates = text
      .replace(/(?:19|20)\d{2}(?:\s*[./年-]\s*(?:0?[1-9]|1[0-2])月?)?/giu, " ")
      .replace(/至今|现在|present|current/giu, " ")
      .replace(/[\d\s./年月日|｜·—–~～-]/gu, "");
    return textWithoutDates.length >= 2
      && !listItemPattern.test(line)
      && !emailPattern.test(text)
      && !/^https?:\/\//iu.test(text)
      && !/^(?:电话|手机|邮箱|博客|主页|地址|技术架构|工作介绍|项目描述)[:：]?$/u.test(text);
  });
}

function listItemCount(body: string) {
  return body.split(/\r?\n/gu).filter((line) => listItemPattern.test(line)).length;
}

function skillEntryTexts(body: string) {
  const lines = body
    .split(/\r?\n/gu)
    .map((line) => visibleText(line.replace(listItemPrefixPattern, "")))
    .filter(Boolean);
  const hasExplicitList = body.split(/\r?\n/gu).some((line) => listItemPattern.test(line));
  const candidates = hasExplicitList
    ? lines
    : lines.flatMap((line) => line.split(/[、·，,；;|]/gu).map((part) => part.trim()));
  return uniqueSkillEntries(candidates);
}

function uniqueSkillEntries(entries: string[]) {
  return [...new Map(
    entries
      .filter((entry) => entry.length >= 2 && entry.length <= 120)
      .filter((entry) => !skillPlaceholderPattern.test(entry))
      .map((entry) => [entry.toLowerCase(), entry]),
  ).values()];
}

function isQualitySkillEntry(entry: string) {
  if (genericSkillPattern.test(entry)) return false;
  if (latinSkillPattern.test(entry)) return true;
  if (skillApplicationPattern.test(entry) && entry.length >= 4) return true;
  return multipleSkillConceptPattern.test(entry) && entry.length >= 6;
}

function skillEntryPoints(entries: string[]) {
  const quantityPoints = entries.length >= 3 ? 4 : entries.length === 2 ? 3 : entries.length === 1 ? 2 : 0;
  const qualityCount = entries.filter(isQualitySkillEntry).length;
  const qualityPoints = qualityCount >= 3 ? 4 : qualityCount === 2 ? 3 : qualityCount === 1 ? 2 : 0;
  return { earnedPoints: quantityPoints + qualityPoints, qualityCount };
}

function positioningText(preamble: string) {
  return preamble
    .split(/\r?\n/gu)
    .filter((line) => {
      const text = visibleText(line);
      return text
        && !emailPattern.test(text)
        && !hasPhone(text)
        && !/(?:https?:\/\/|www\.|\b[A-Z0-9.-]+\.(?:com|cn|net|org)\b)/iu.test(text)
        && !/^(?:电话|手机|邮箱|博客|主页|地址|微信)\s*[:：]/u.test(text);
    })
    .map(visibleText)
    .join("");
}

function scoreLevel(score: number): ResumeCompletenessResult["level"] {
  if (score >= 90) return "完整";
  if (score >= 70) return "较完整";
  if (score >= 40) return "基本完整";
  return "待补充";
}

export function resumeCompletenessTone(score: number): ResumeCompletenessTone {
  if (score < 40) return "low";
  if (score <= 80) return "medium";
  return "high";
}

export function evaluateResumeCompleteness(markdown: string): ResumeCompletenessResult {
  const parsed = parseMarkdown(markdown);
  const name = parsed.h1.length === 1 ? parsed.h1[0] : "";
  const sampleIdentity = SAMPLE_IDENTITIES.includes(name);
  const email = markdown.match(emailPattern)?.[0] ?? "";
  const phoneNumbers = recognizedPhoneNumbers(markdown);
  const experienceSections = sectionsByKind(parsed.sections, "experience");
  const educationSections = sectionsByKind(parsed.sections, "education");
  const skillsSections = sectionsByKind(parsed.sections, "skills");
  const experienceBody = experienceSections.map((section) => section.body).join("\n");
  const educationBody = educationSections.map((section) => section.body).join("\n");
  const skillsBody = skillsSections.map((section) => section.body).join("\n");
  const position = positioningText(parsed.preamble);
  const experienceHasIdentity = hasMeaningfulIdentityLine(experienceBody);
  const experienceHasDate = datePattern.test(visibleText(experienceBody));
  const educationHasIdentity = hasMeaningfulIdentityLine(educationBody);
  const educationHasDate = datePattern.test(visibleText(educationBody));
  const experienceDetails = listItemCount(experienceBody);
  const skillEntries = skillEntryTexts(skillsBody);
  const skillPoints = skillEntryPoints(skillEntries);

  const checks: ResumeCompletenessCheck[] = [
    check(
      "name",
      "basics",
      "姓名",
      name && !sampleIdentity ? 8 : 0,
      8,
      name ? "姓名仍是系统示例内容。" : "缺少唯一的一级标题姓名。",
      "把第一行一级标题改为你的真实姓名。",
    ),
    check(
      "phone",
      "basics",
      "联系电话",
      phoneNumbers.some((digits) => digits !== SAMPLE_PHONE_DIGITS) ? 6 : 0,
      6,
      "未识别到有效的非示例联系电话。",
      "补充常用联系电话，并检查区号和位数。",
    ),
    check(
      "email",
      "basics",
      "联系邮箱",
      email && !/@example\.(?:com|org|net)$/iu.test(email) ? 6 : 0,
      6,
      "未识别到有效的非示例邮箱。",
      "补充用于求职联系的邮箱地址。",
    ),
    check(
      "positioning",
      "basics",
      "职业定位",
      position.length >= 10 ? 10 : position.length > 0 ? 5 : 0,
      10,
      position ? "职业定位过短，目标方向还不够明确。" : "姓名和联系方式后缺少职业定位。",
      "用一句话写明目标岗位、经验方向或核心优势。",
    ),
    check(
      "experience-section",
      "experience",
      "经历章节",
      experienceSections.length > 0 && visibleText(experienceBody) ? 10 : 0,
      10,
      "缺少工作、实习、项目或研究经历。",
      "至少补充一段与目标岗位相关的经历。",
    ),
    check(
      "experience-basics",
      "experience",
      "经历基本信息",
      experienceHasIdentity && experienceHasDate ? 10 : experienceHasIdentity || experienceHasDate ? 5 : 0,
      10,
      "经历中的单位、角色或起止时间不完整。",
      "为经历补齐单位或项目、角色以及起止时间。",
    ),
    check(
      "experience-details",
      "experience",
      "经历成果描述",
      experienceDetails >= 3 ? 15 : experienceDetails === 2 ? 10 : experienceDetails === 1 ? 5 : 0,
      15,
      "可验证的经历成果条目不足。",
      "增加 3 条以上职责或成果，优先写行动、结果和数据。",
    ),
    check(
      "education-section",
      "education",
      "教育章节",
      educationSections.length > 0 && visibleText(educationBody) ? 8 : 0,
      8,
      "缺少教育经历章节。",
      "补充学校、专业或学习经历。",
    ),
    check(
      "education-basics",
      "education",
      "教育基本信息",
      educationHasIdentity && educationHasDate ? 7 : educationHasIdentity || educationHasDate ? 3 : 0,
      7,
      "教育经历中的学校、专业或时间不完整。",
      "补齐学校或专业，以及起止时间。",
    ),
    check(
      "skills-section",
      "skills",
      "技能内容",
      skillEntries.length >= 2 ? 7 : skillEntries.length === 1 ? 4 : 0,
      7,
      skillsSections.length > 0 ? "技能章节缺少具体、有效的内容。" : "缺少技能章节及其具体内容。",
      "补充至少 2 项具体技能，可写明技术、工具、熟悉程度或应用场景。",
    ),
    check(
      "skills-entries",
      "skills",
      "技能条目质量",
      skillPoints.earnedPoints,
      8,
      skillEntries.length < 3
        ? "具体技能条目不足 3 项。"
        : `已有 ${skillEntries.length} 项技能，但只有 ${skillPoints.qualityCount} 项足够具体。`,
      "列出至少 3 项岗位相关技能，并写明工具、熟悉程度或实际应用场景。",
    ),
    check(
      "structure",
      "structure",
      "文档结构",
      (parsed.h1.length === 1 && Boolean(name) ? 2 : 0) + (parsed.h2.length >= 3 ? 3 : 0),
      5,
      "一级标题不唯一，或二级章节少于 3 个。",
      "保留一个姓名一级标题，并使用至少 3 个清晰的二级章节。",
    ),
  ];

  const rawScore = checks.reduce((total, item) => total + item.earnedPoints, 0);
  const scoreCaps: ResumeCompletenessCap[] = [];
  if (sampleIdentity) {
    scoreCaps.push({ id: "sample-identity", maxScore: 20, reason: "姓名仍是系统示例内容，完整度最高按 20 分计算。" });
  }
  if (SAMPLE_CONTENT_MARKERS.some((marker) => markdown.includes(marker))) {
    scoreCaps.push({ id: "sample-content", maxScore: 60, reason: "正文仍包含系统示例内容，完整度最高按 60 分计算。" });
  }
  const score = Math.min(rawScore, ...scoreCaps.map((cap) => cap.maxScore), 100);

  return {
    score,
    rawScore,
    earnedPoints: rawScore,
    maxPoints: 100,
    level: scoreLevel(score),
    checks,
    scoreCaps,
  };
}
