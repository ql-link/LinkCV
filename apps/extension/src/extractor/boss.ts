import type { BossCaptureResult, BossJobCapture } from "../contracts";

const BOSS_HOSTS = new Set(["zhipin.com", "www.zhipin.com", "m.zhipin.com"]);
const BOSS_JOB_PATH = /^\/job_detail\/[A-Za-z0-9_-]{1,128}\.html$/;
const BOSS_JOB_LIST_PATH = /^\/web\/geek\/jobs\/?$/;

const DETAIL_ROOT_SELECTORS = [
  [".user-center-job-detail-box", 10_000],
  [".job-detail-container", 9_000],
  [".job-detail-box", 8_000],
  [".job-detail-wrapper", 7_500],
  [".job-detail-wrap", 7_000],
  [".job-detail-panel", 6_500],
  ["[class*='job-detail-container']", 6_000],
  ["[class*='job-detail-box']", 5_500],
  ["[class*='job-detail-wrapper']", 5_000],
  ["[class*='job-detail-wrap']", 4_500],
  ["[class*='job-detail-panel']", 4_000],
] as const;

const DETAIL_TEXT_SELECTORS = [
  ".job-detail-body .desc",
  ".job-sec-text",
  ".job-detail .text",
  ".job-detail-content",
  "[class*='job-sec-text']",
] as const;

const LIST_CONTAINER_SELECTOR = ".job-list, .job-list-box, .search-job-result, [class*='job-list']";
const CARD_SELECTOR = ".job-card-box, .job-card-wrapper, .job-card-wrap, .job-card, li";
const CARD_OR_RECOMMENDATION_SELECTOR = ".recommend-list, .job-card, .job-card-box, [class*='job-card']";
const SELECTED_CARD_SELECTOR = [
  ".job-card-box.active",
  ".job-card-box.selected",
  ".job-card-box.current",
  ".job-card-wrapper.active",
  ".job-card-wrapper.selected",
  ".job-card-wrap.active",
  ".job-card-wrap.selected",
  ".job-card.active",
  ".job-card.selected",
  "[aria-selected='true']",
  "[data-selected='true']",
].join(", ");
const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6, [role='heading']";

const DESCRIPTION_SELECTORS = [
  [".job-detail-body .desc", 9_000],
  [".job-sec-text", 7_000],
  [".job-detail .text", 6_000],
  [".job-detail-content", 5_000],
  [".job-detail-box .job-detail", 4_000],
  ["[class*='job-sec-text']", 3_000],
] as const;

const NON_SKILL_MARKERS = [
  "五险一金",
  "补充医疗",
  "年终奖",
  "股票期权",
  "带薪年假",
  "节日福利",
  "零食下午茶",
  "定期体检",
  "加班补助",
  "交通补助",
  "通讯补贴",
  "住房补贴",
  "团建聚餐",
  "双休",
  "单双休",
  "包吃",
  "包住",
  "生日福利",
  "高温补贴",
  "员工旅游",
  "全勤奖",
];

const EDUCATION_RE = /^(?:学历不限|初中|高中|中专|大专|本科|硕士|博士)(?:及以上)?$/;
const EXPERIENCE_RE = /^(?:经验不限|不限经验|无需经验|应届(?:生|毕业生)?|在校生|\d+(?:-\d+)?年(?:以上|以内)?(?:经验)?)$/;
const WORK_SCHEDULE_PART = String.raw`(?:每周\s*)?\d+\s*天\s*[/／]\s*周|(?:至少\s*|连续\s*)?\d+\s*个?月|长期实习|短期实习|双休|单双休|排班|远程办公|居家办公|弹性工作`;
const WORK_SCHEDULE_RE = new RegExp(WORK_SCHEDULE_PART);
const WORK_SCHEDULE_GLOBAL_RE = new RegExp(WORK_SCHEDULE_PART, "g");
const BENEFIT_RE = /(?:福利|补贴|补助|奖金|全勤奖|员工旅游|带薪年假|五险|一金|体检|团建|下午茶|餐补|包吃|包住|免费班车|节日礼品)/;
const SIZE_RE = /^(?:少于\s*)?\d+(?:\s*[-~—–至]\s*\d+)?\s*人|\d+\s*人以上$/;
const FINANCING_RE = /(?:未融资|不需要融资|天使轮|[A-D]轮|战略融资|已上市|上市公司)/;

export function extractBossJob(document: Document, sourceUrl: string): BossCaptureResult {
  if (!isBossJobUrl(sourceUrl)) {
    return {
      ok: false,
      error: "UNSUPPORTED_PAGE",
      message: "请先打开一个 BOSS 直聘岗位详情页。",
    };
  }

  try {
    const isSplitView = isBossJobListUrl(sourceUrl);
    const detailRoot = isSplitView ? findSplitViewDetailRoot(document) : document;
    if (!detailRoot) {
      return {
        ok: false,
        error: "CAPTURE_INCOMPLETE",
        message: "未识别到右侧岗位详情，请先在左侧选择一个岗位，等待详情加载完成后重试。",
      };
    }

    const detailJobTitle = firstText(detailRoot, [
      ".job-detail-header .job-title",
      ".job-detail-header .job-name",
      ".job-detail-info .job-title",
      ".job-detail-info .job-name",
      ".job-banner .name h1",
      ".job-primary .job-name h1",
      ".job-primary h1",
      ".job-detail-box h1",
      ".job-detail-box h2",
      ".job-detail-container h1",
      ".job-detail-container h2",
      "[class*='job-title']",
      "[class*='job-name']",
      "h1",
    ]);
    const detailCompanyName =
      firstAttribute(detailRoot, [
        ".sider-company .company-info a[title]",
        ".company-info h3 a[title]",
      ], "title") ??
      firstText(detailRoot, [
        ".sider-company .company-info .name",
        ".job-detail-company .company-name",
        ".company-info h3 a",
        ".job-primary .company-name",
        "[class*='company-name']",
        "a[href*='/gongsi/']",
      ]);
    const selectedJob = isSplitView
      ? findSelectedJob(document, detailRoot, detailJobTitle, detailCompanyName, sourceUrl)
      : undefined;
    const fieldRoots = uniqueRoots([detailRoot, selectedJob?.card]);
    const jobTitle = detailJobTitle ?? firstTextAcross(fieldRoots, [
      ".job-name",
      ".job-title",
      "[class*='job-name']",
      "[class*='job-title']",
      "h3",
    ]);
    const companyName =
      detailCompanyName ??
      firstTextAcross(fieldRoots, [
        ".company-name",
        ".company-info .name",
        "[class*='company-name']",
        "a[href*='/gongsi/']",
      ]) ??
      companyFromBossInfo(detailRoot);
    const resolvedSourceUrl = resolveBossSourceUrl(
      document,
      sourceUrl,
      selectedJob,
    );
    if (!resolvedSourceUrl) {
      return {
        ok: false,
        error: "CAPTURE_INCOMPLETE",
        message: "已读取右侧岗位详情，但无法确定当前岗位的来源 ID。请点击岗位标题打开独立详情页后重试。",
      };
    }

    const descriptionText = findDescription(detailRoot);
    const jobTags = uniqueTexts(detailRoot, [
      ".job-tags span",
      ".job-tags li",
      ".job-keyword-list li",
      ".job-labels li",
      ".job-label-list li",
      "[class*='job-tag'] span",
      "[class*='job-tag'] li",
    ]);
    const meta = unique(fieldRoots.flatMap(primaryMetadata));
    const companyTags = companyMetadata(detailRoot);
    const recruiter = recruiterMetadata(detailRoot);
    const directExperienceText = firstTextAcross(fieldRoots, [
      ".text-experience",
      ".text-experiece",
      ".job-experience",
      "[class*='experience']",
    ]);
    const jobMetadata = unique([
      ...(directExperienceText ? [directExperienceText] : []),
      ...meta,
      ...jobTags,
    ]);

    const capture: BossJobCapture = {
      job_title: jobTitle,
      company_name: companyName,
      description_text: descriptionText,
      skills: jobTags.filter(isLikelySkill),
      employment_type_text: [...jobTags, jobTitle ?? ""].find((tag) => /全职|兼职|实习|合同|临时/.test(tag)),
      education_text:
        firstTextAcross(fieldRoots, [".text-degree", ".job-degree", "[class*='degree']"]) ??
        meta.find((item) => EDUCATION_RE.test(item)),
      experience_text: jobMetadata.find((item) => EXPERIENCE_RE.test(item)),
      work_schedule_text: extractWorkSchedule(jobMetadata),
      work_city:
        firstTextAcross(fieldRoots, [
          ".text-city",
          ".job-city",
          "[class*='text-city']",
        ]) ??
        meta.find(isLikelyCity) ??
        firstTextAcross(fieldRoots, [".job-area", "[class*='job-area']"]),
      work_address: firstTextAcross(fieldRoots, [
        ".location-address",
        ".job-location .location-address",
        ".job-address .job-address-desc",
        ".job-address-desc",
        ".job-address",
        "[class*='location-address']",
      ]),
      salary_text: firstTextAcross(fieldRoots, [
        ".job-banner .salary",
        ".job-primary .salary",
        ".job-name .salary",
        "[class*='salary']",
      ]),
      company_legal_name: firstText(detailRoot, [
        ".company-business .company-name",
        ".company-info-box .company-full-name",
      ]),
      company_industry: companyTags.find(isIndustryTag),
      company_size: companyTags.find((tag) => SIZE_RE.test(tag)),
      company_financing_stage: companyTags.find((tag) => FINANCING_RE.test(tag)),
      company_description: firstText(detailRoot, [
        ".company-info-box .fold-text",
        ".company-intro .text",
        ".company-info .company-desc",
      ]),
      company_tags: companyTags,
      recruiter_name: recruiter.name,
      recruiter_title: recruiter.title,
    };

    const missing = [
      !capture.job_title && "岗位名称",
      !capture.company_name && "公司名称",
      !capture.description_text && "职位描述",
    ].filter(Boolean) as string[];
    if (missing.length > 0) {
      return {
        ok: false,
        error: "CAPTURE_INCOMPLETE",
        message: `页面读取不完整，缺少：${missing.join("、")}。可刷新页面后重试。`,
      };
    }

    const warnings: string[] = [];
    if (!capture.salary_text) warnings.push("未识别到薪资");
    if (capture.skills.length === 0) warnings.push("未识别到技能标签");
    if (!capture.work_city && !capture.work_address) warnings.push("未识别到工作地点");
    return { ok: true, sourceUrl: resolvedSourceUrl, capture, warnings };
  } catch {
    return {
      ok: false,
      error: "CAPTURE_FAILED",
      message: "读取页面时发生异常，请刷新 BOSS 详情页后重试。",
    };
  }
}

export function isBossJobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      BOSS_HOSTS.has(url.hostname) &&
      (BOSS_JOB_PATH.test(url.pathname) || BOSS_JOB_LIST_PATH.test(url.pathname))
    );
  } catch {
    return false;
  }
}

function isBossJobListUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && BOSS_HOSTS.has(url.hostname) && BOSS_JOB_LIST_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

function findSplitViewDetailRoot(document: Document): Element | undefined {
  const candidates = new Map<Element, number>();
  for (const [selector, bonus] of DETAIL_ROOT_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      candidates.set(element, Math.max(candidates.get(element) ?? 0, bonus));
    }
  }
  for (const selector of DETAIL_TEXT_SELECTORS) {
    for (const detail of document.querySelectorAll(selector)) {
      let ancestor = detail.parentElement;
      for (let depth = 0; ancestor && depth < 6 && ancestor !== document.body; depth += 1) {
        candidates.set(ancestor, Math.max(candidates.get(ancestor) ?? 0, 1_000 - depth * 100));
        ancestor = ancestor.parentElement;
      }
    }
  }
  for (const heading of semanticLabelElements(document, "职位描述")) {
    addAncestorCandidates(candidates, heading, 8, 2_000);
  }
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="/job_detail/"]')) {
    if (/查看更多(?:职位)?信息/.test(elementText(anchor))) {
      addAncestorCandidates(candidates, anchor, 8, 1_800);
    }
  }

  return [...candidates.entries()]
    .filter(([element]) => !element.closest(CARD_OR_RECOMMENDATION_SELECTOR))
    .map(([element, selectorBonus]) => ({ element, score: detailRootScore(element, selectorBonus) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)[0]?.element;
}

function detailRootScore(element: Element, selectorBonus: number): number {
  const text = elementText(element);
  if (text.length < 30) return -1;
  const descriptionMarkers = /职位描述|岗位职责|任职要求|职位要求/.test(text) ? 4_000 : 0;
  const hasDescriptionHeading = semanticLabelElements(element, "职位描述").length > 0 ? 5_000 : 0;
  const hasCurrentDetailLink = [...element.querySelectorAll<HTMLAnchorElement>('a[href*="/job_detail/"]')].some(
    (anchor) => /查看更多(?:职位)?信息/.test(elementText(anchor)),
  ) ? 2_000 : 0;
  const hasDescription = DETAIL_TEXT_SELECTORS.some((selector) => queryAll(element, selector).length > 0) ? 3_000 : 0;
  if (!descriptionMarkers && !hasDescriptionHeading && !hasDescription) return -1;
  const hasTitle = firstText(element, [
    ".job-title",
    ".job-name",
    "[class*='job-title']",
    "[class*='job-name']",
    "h1",
  ]) ? 2_000 : 0;
  const hasSalary = firstText(element, [".salary", "[class*='salary']"]) ? 1_000 : 0;
  const cardPenalty = element.querySelectorAll(".job-card, .job-card-box, [class*='job-card']").length * 4_000;
  return selectorBonus + descriptionMarkers + hasDescriptionHeading + hasCurrentDetailLink + hasDescription + hasTitle + hasSalary + Math.min(text.length, 3_000) - cardPenalty;
}

function addAncestorCandidates(
  candidates: Map<Element, number>,
  start: Element,
  maxDepth: number,
  bonus: number,
): void {
  let ancestor = start.parentElement;
  for (let depth = 0; ancestor && depth < maxDepth && ancestor !== start.ownerDocument.body; depth += 1) {
    candidates.set(ancestor, Math.max(candidates.get(ancestor) ?? 0, bonus - depth * 100));
    ancestor = ancestor.parentElement;
  }
}

interface SelectedJob {
  card: Element;
  sourceUrl: string;
}

function findSelectedJob(
  document: Document,
  detailRoot: ParentNode,
  jobTitle: string | undefined,
  companyName: string | undefined,
  pageUrl: string,
): SelectedJob | undefined {
  const candidates = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/job_detail/"]')]
    .map((anchor) => {
      const sourceUrl = normalizeBossDetailUrl(anchor.getAttribute("href") ?? "", pageUrl);
      if (!sourceUrl) return undefined;
      const card = anchor.closest(CARD_SELECTOR) ?? anchor;
      const selected = isSelectedCard(card);
      const titleMatch = matchesCardField(card, jobTitle, [
        ".job-name",
        ".job-title",
        "[class*='job-name']",
        "[class*='job-title']",
        "h3",
      ]);
      const companyMatch = matchesCardField(card, companyName, [
        ".company-name",
        ".company-info .name",
        "[class*='company-name']",
      ]);
      const inDetailRoot = detailRoot instanceof Element && detailRoot.contains(anchor);
      const isMoreDetailsLink = /查看更多(?:职位)?信息/.test(elementText(anchor));
      const score =
        (selected ? 20_000 : 0) +
        (isMoreDetailsLink && inDetailRoot ? 18_000 : 0) +
        (inDetailRoot ? 8_000 : 0) +
        (titleMatch === "exact" ? 4_000 : titleMatch === "contains" ? 2_000 : 0) +
        (companyMatch === "exact" ? 2_000 : companyMatch === "contains" ? 1_000 : 0);
      return { card, sourceUrl, selected, titleMatch, companyMatch, inDetailRoot, isMoreDetailsLink, score };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  const exactTitleUrls = unique(
    candidates.filter((candidate) => candidate.titleMatch === "exact").map((candidate) => candidate.sourceUrl),
  );
  const ranked = candidates
    .filter((candidate) =>
      (candidate.selected && (!jobTitle || candidate.titleMatch === "exact")) ||
      (candidate.isMoreDetailsLink && candidate.inDetailRoot) ||
      (candidate.inDetailRoot && candidate.titleMatch === "exact") ||
      (candidate.titleMatch === "exact" && candidate.companyMatch !== "none") ||
      (candidate.titleMatch === "exact" && exactTitleUrls.length === 1),
    )
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best) return findSelectedJobFromDataId(document, pageUrl, jobTitle, companyName);

  const equallyRankedUrls = unique(
    ranked.filter((candidate) => candidate.score === best.score).map((candidate) => candidate.sourceUrl),
  );
  if (equallyRankedUrls.length > 1) {
    return findSelectedJobFromDataId(document, pageUrl, jobTitle, companyName);
  }
  const matchingListCard = candidates
    .filter((candidate) => candidate.sourceUrl === best.sourceUrl && !candidate.inDetailRoot)
    .sort((left, right) => right.score - left.score)[0];
  return { card: matchingListCard?.card ?? best.card, sourceUrl: best.sourceUrl };
}

function findSelectedJobFromDataId(
  document: Document,
  pageUrl: string,
  jobTitle: string | undefined,
  companyName: string | undefined,
): SelectedJob | undefined {
  for (const selected of document.querySelectorAll(SELECTED_CARD_SELECTOR)) {
    if (!selected.closest(LIST_CONTAINER_SELECTOR)) continue;
    const card = selected.closest(CARD_SELECTOR) ?? selected;
    const titleMatch = matchesCardField(card, jobTitle, [
      ".job-name",
      ".job-title",
      "[class*='job-name']",
      "[class*='job-title']",
      "h3",
    ]);
    const companyMatch = matchesCardField(card, companyName, [
      ".company-name",
      ".company-info .name",
      "[class*='company-name']",
    ]);
    if ((jobTitle && titleMatch !== "exact") || (companyName && companyMatch === "none")) continue;
    const attributeRoots = uniqueRoots([selected, card, card.parentElement ?? undefined]);
    for (const attribute of ["data-jobid", "data-job-id", "data-jid", "data-encrypt-job-id"]) {
      for (const root of attributeRoots) {
        const id = normalizeText(
          (root instanceof Element ? root.getAttribute(attribute) : null) ??
          root.querySelector(`[${attribute}]`)?.getAttribute(attribute) ??
          "",
        );
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) continue;
        const sourceUrl = normalizeBossDetailUrl(`/job_detail/${id}.html`, pageUrl);
        if (sourceUrl) return { card, sourceUrl };
      }
    }
  }
  return undefined;
}

function resolveBossSourceUrl(
  document: Document,
  pageUrl: string,
  selectedJob: SelectedJob | undefined,
): string | undefined {
  const currentDetailUrl = normalizeBossDetailUrl(pageUrl, pageUrl);
  if (currentDetailUrl) return currentDetailUrl;

  if (selectedJob) return selectedJob.sourceUrl;

  for (const selector of ["link[rel='canonical']", "meta[property='og:url']"]) {
    const element = document.querySelector(selector);
    const raw = element?.getAttribute(selector.startsWith("link") ? "href" : "content") ?? "";
    const url = normalizeBossDetailUrl(raw, pageUrl);
    if (url) return url;
  }

  try {
    const url = new URL(pageUrl);
    for (const parameter of ["jobId", "job_id", "encryptJobId"]) {
      const id = url.searchParams.get(parameter) ?? "";
      if (/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        return normalizeBossDetailUrl(`/job_detail/${id}.html`, pageUrl);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function normalizeBossDetailUrl(value: string, baseUrl: string): string | undefined {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "https:" || !BOSS_HOSTS.has(url.hostname) || !BOSS_JOB_PATH.test(url.pathname)) {
      return undefined;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function isSelectedCard(card: Element): boolean {
  let element: Element | null = card;
  for (let depth = 0; element && depth < 4; depth += 1) {
    if (
      element.matches(SELECTED_CARD_SELECTOR) ||
      /(?:^|[-_])(active|selected|current|checked|cur)(?:$|[-_])/i.test(element.className)
    ) {
      return true;
    }
    if (element.matches(LIST_CONTAINER_SELECTOR)) break;
    element = element.parentElement;
  }
  return false;
}

function matchesCardField(
  card: ParentNode,
  expected: string | undefined,
  selectors: string[],
): "exact" | "contains" | "none" {
  if (!expected) return "none";
  const normalizedExpected = normalizeComparableText(expected);
  const values = selectors.flatMap((selector) => queryAll(card, selector).map(elementText));
  if (values.some((value) => normalizeComparableText(value) === normalizedExpected)) return "exact";
  if (values.some((value) => normalizeComparableText(value).includes(normalizedExpected))) return "contains";
  return normalizeComparableText(card.textContent ?? "").includes(normalizedExpected) ? "contains" : "none";
}

function findDescription(root: ParentNode): string | undefined {
  const candidates = new Map<Element, number>();
  for (const [selector, bonus] of DESCRIPTION_SELECTORS) {
    for (const element of queryAll(root, selector)) {
      const text = elementText(element);
      if (text.length < 30 || element.closest(CARD_OR_RECOMMENDATION_SELECTOR)) {
        continue;
      }
      const markerBonus = /职位描述|岗位职责|任职要求|职位要求/.test(text) ? 1_500 : 0;
      const oversizePenalty = Math.max(0, text.length - 20_000);
      const score = bonus + markerBonus + Math.min(text.length, 4_000) - oversizePenalty;
      candidates.set(element, Math.max(candidates.get(element) ?? 0, score));
    }
  }
  for (const candidate of semanticDescriptionCandidates(root)) {
    const text = elementText(candidate.element);
    const markerBonus = /岗位职责|任职要求|职位要求/.test(text) ? 6_000 : 0;
    const punctuationBonus = /[；;。\n]/.test(text) ? 1_000 : 0;
    const score = 5_000 + markerBonus + punctuationBonus + Math.min(text.length, 4_000) - candidate.distance * 100;
    candidates.set(candidate.element, Math.max(candidates.get(candidate.element) ?? 0, score));
  }
  const best = [...candidates.entries()].sort((left, right) => right[1] - left[1])[0];
  return best ? elementText(best[0]) : undefined;
}

function semanticDescriptionCandidates(root: ParentNode): Array<{ element: Element; distance: number }> {
  const results = new Map<Element, number>();
  const headings = semanticLabelElements(root, "职位描述");
  for (const heading of headings) {
    let cursor: Element | null = heading;
    for (let level = 0; cursor && level < 4; level += 1) {
      let sibling = cursor.nextElementSibling;
      for (let distance = 1; sibling && distance <= 8; distance += 1) {
        for (const candidate of deepestLongTextElements(sibling)) {
          if (!candidate.closest(CARD_OR_RECOMMENDATION_SELECTOR)) {
            results.set(candidate, Math.min(results.get(candidate) ?? Number.POSITIVE_INFINITY, level * 8 + distance));
          }
        }
        sibling = sibling.nextElementSibling;
      }
      cursor = cursor.parentElement;
      if (cursor === heading.ownerDocument.body) break;
    }
  }
  return [...results.entries()].map(([element, distance]) => ({ element, distance }));
}

function semanticLabelElements(root: ParentNode, label: string): Element[] {
  const normalizedLabel = normalizeComparableText(label);
  return queryAll(root, `${HEADING_SELECTOR}, .title, [class*='title']`).filter((element) => {
    if (normalizeComparableText(elementText(element)) !== normalizedLabel) return false;
    return ![...element.children].some(
      (child) => normalizeComparableText(elementText(child)) === normalizedLabel,
    );
  });
}

function deepestLongTextElements(element: Element): Element[] {
  const text = elementText(element);
  if (text.length < 30 || text.length > 20_000) return [];
  const childCandidates = [...element.children].flatMap(deepestLongTextElements);
  return childCandidates.length > 0 ? childCandidates : [element];
}

function primaryMetadata(root: ParentNode): string[] {
  const direct = uniqueTexts(root, [
    ".job-detail-header .tag-list > li",
    ".job-detail-header .job-limit > span",
    ".job-detail-header .job-info > span",
    ".job-detail-info .job-limit > span",
    ".job-detail-info .job-info > span",
    ".job-limit > span",
    ".job-limit > li",
    ".job-info > span",
    ".job-info > li",
  ]);
  if (direct.length > 0) return direct;
  const container = root.querySelector(
    ".job-banner .job-primary p, .job-banner .info-primary p, .job-primary .job-limit, .job-primary p, .job-detail-header .job-limit, .job-detail-info .job-limit",
  );
  if (!container) return [];
  const values: string[] = [];
  let current = "";
  for (const node of container.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).matches("em, i.vline, .vline")) {
      const value = normalizeText(current);
      if (value) values.push(value);
      current = "";
    } else {
      current += node.textContent ?? "";
    }
  }
  const value = normalizeText(current);
  if (value) values.push(value);
  return unique(values.flatMap((item) => item.split(/[|·\n]/).map(normalizeText).filter(Boolean)));
}

function companyMetadata(root: ParentNode): string[] {
  const direct = uniqueTexts(root, [
    ".sider-company .company-tag-list li",
    ".company-info .company-tag-list li",
    ".sider-company .company-info p span",
    ".company-info .company-stage",
    ".company-info .company-scale",
    ".company-info .company-industry",
  ]);
  if (direct.length > 0) return direct;
  const fallback = firstText(root, [".sider-company .company-info p", ".company-info p"]);
  return fallback ? unique(fallback.split(/[|·\n]/).map(normalizeText).filter(Boolean)) : [];
}

function recruiterMetadata(root: ParentNode): { name?: string; title?: string } {
  const combined = firstText(root, [
    ".boss-info-attr",
    ".job-boss-info .boss-info-attr",
    ".boss-info .boss-info-attr",
  ]);
  const explicitName = firstText(root, [
    ".boss-info-attr .name",
    ".job-boss-info .name",
    ".boss-info .name",
  ]);
  const parts = (combined ?? explicitName ?? "").split(/[·|]/).map(normalizeText).filter(Boolean);
  return {
    name: explicitName ? normalizeText(explicitName.split(/[·|]/)[0] ?? explicitName) : parts[0],
    title: parts.length > 1 ? parts.slice(1).join(" · ") : undefined,
  };
}

function companyFromBossInfo(root: ParentNode): string | undefined {
  const combined = firstText(root, [
    ".job-detail-body .job-boss-info .boss-info-attr",
    ".job-boss-info .boss-info-attr",
  ]);
  if (!combined) return undefined;
  const candidate = normalizeText(combined.split(/[·|]/)[0] ?? "");
  const recruiterName = firstText(root, [
    ".job-detail-body .job-boss-info .name",
    ".job-boss-info .name",
  ]);
  if (!candidate || (recruiterName && normalizeComparableText(candidate) === normalizeComparableText(recruiterName))) {
    return undefined;
  }
  return candidate;
}

function firstText(root: ParentNode, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const element = queryAll(root, selector)[0];
    if (!element) continue;
    const value = elementText(element);
    if (value) return value;
  }
  return undefined;
}

function firstAttribute(root: ParentNode, selectors: string[], attribute: string): string | undefined {
  for (const selector of selectors) {
    const value = normalizeText(queryAll(root, selector)[0]?.getAttribute(attribute) ?? "");
    if (value) return value;
  }
  return undefined;
}

function firstTextAcross(roots: ParentNode[], selectors: string[]): string | undefined {
  for (const root of roots) {
    const value = firstText(root, selectors);
    if (value) return value;
  }
  return undefined;
}

function uniqueTexts(root: ParentNode, selectors: readonly string[]): string[] {
  return unique(
    selectors.flatMap((selector) =>
      queryAll(root, selector).map(elementText).filter(Boolean),
    ),
  );
}

function queryAll(root: ParentNode, selector: string): Element[] {
  const matches = root instanceof Element && root.matches(selector) ? [root] : [];
  return [...matches, ...root.querySelectorAll(selector)];
}

function uniqueRoots(roots: Array<ParentNode | undefined>): ParentNode[] {
  return [...new Set(roots.filter((root): root is ParentNode => Boolean(root)))];
}

function elementText(element: Element): string {
  const innerText = element instanceof HTMLElement ? element.innerText : undefined;
  return normalizeText(innerText || element.textContent || "");
}

function normalizeText(value: string): string {
  return value
    .replace(/[\uE031-\uE03A]/g, (character) => String(character.charCodeAt(0) - 0xE031))
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\v\f \u00a0\u3000]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeComparableText(value: string): string {
  return normalizeText(value).replace(/\s+/g, "").toLocaleLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isLikelySkill(value: string): boolean {
  if (/全职|兼职|实习|合同|临时/.test(value)) return false;
  if (EDUCATION_RE.test(value) || EXPERIENCE_RE.test(value) || WORK_SCHEDULE_RE.test(value)) return false;
  if (BENEFIT_RE.test(value)) return false;
  return !NON_SKILL_MARKERS.some((marker) => value.includes(marker));
}

function extractWorkSchedule(values: string[]): string | undefined {
  const parts = values.flatMap((value) => value.match(WORK_SCHEDULE_GLOBAL_RE) ?? []);
  const result = unique(parts).join(" ");
  return result || undefined;
}

function isIndustryTag(value: string): boolean {
  return !SIZE_RE.test(value) && !FINANCING_RE.test(value);
}

function isLikelyCity(value: string): boolean {
  return (
    value.length <= 20 &&
    !EDUCATION_RE.test(value) &&
    !EXPERIENCE_RE.test(value) &&
    !/薪|K|元|全职|兼职|实习/.test(value)
  );
}
