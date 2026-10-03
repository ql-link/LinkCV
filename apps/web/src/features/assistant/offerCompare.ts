import { t } from "@/i18n";
import type { JobApplicationSummary, SalaryPeriod } from "../../api/client";

const PERIOD_LABELS: Record<SalaryPeriod, string> = { hour: "时", day: "日", month: "月", year: "年" };
const CURRENCY_SYMBOLS: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€", GBP: "£", JPY: "¥", HKD: "HK$" };

type OfferSalary = Pick<JobApplicationSummary, "offer_salary" | "offer_salary_currency" | "offer_salary_period">;

function amountOf(offer: OfferSalary): number | null {
  if (offer.offer_salary === null || offer.offer_salary === "") return null;
  const amount = Number(offer.offer_salary);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

// 首页 Offer 对比卡里的薪资文案：人民币过千显示为 K，如 32K/月；其他币种保留币种符号或代码。
export function formatOfferSalary(offer: OfferSalary): string {
  const amount = amountOf(offer);
  if (amount === null) return t("薪资待填");
  const currency = offer.offer_salary_currency ?? "CNY";
  const period = offer.offer_salary_period ? `/${t(PERIOD_LABELS[offer.offer_salary_period])}` : "";
  const rounded = (value: number) => String(Math.round(value * 10) / 10);
  const symbol = CURRENCY_SYMBOLS[currency];
  if (currency === "CNY" && amount >= 1000) return `${rounded(amount / 1000)}K${period}`;
  if (symbol) return `${symbol}${rounded(amount)}${period}`;
  return `${rounded(amount)} ${currency}${period}`;
}

// 两个 Offer 的薪资比较：币种与计薪周期相同才比较，否则不下结论。
export function describeOfferGap(offers: OfferSalary[]): string | null {
  if (offers.length < 2) return null;
  const [first, second] = offers;
  const a = amountOf(first);
  const b = amountOf(second);
  if (a === null || b === null) return null;
  if ((first.offer_salary_currency ?? "CNY") !== (second.offer_salary_currency ?? "CNY") || first.offer_salary_period !== second.offer_salary_period) return null;
  const gap = Math.round((Math.abs(a - b) / Math.max(a, b)) * 100);
  return gap === 0 ? t("薪资持平") : t("薪资相差 {value0}%", { value0: gap });
}
