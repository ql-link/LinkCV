import { getLocale, t } from "@/i18n";

// DATE is a calendar date. Never parse it as UTC midnight or attach a made-up time.
export function parseOfferDate(value: string | null | undefined): Date | null {
  if (!value || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return year >= 1000 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function offerDeadline(value: string | null | undefined, now: Date) {
  const date = parseOfferDate(value);
  if (!date) return null;
  const daysLeft = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
  const label = daysLeft === 0 ? t("今天截止") : daysLeft > 0 ? t("还有 {value0} 天回复", { value0: daysLeft }) : t("回复截止已过 {value0} 天", { value0: -daysLeft });
  return { date, daysLeft, label };
}

export function formatOfferDate(value: string | null | undefined): string | null {
  const date = parseOfferDate(value);
  return date ? new Intl.DateTimeFormat(getLocale(), { year: "numeric", month: "short", day: "numeric" }).format(date) : null;
}
