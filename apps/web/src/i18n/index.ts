import { useSyncExternalStore } from "react";
import { messages } from "./messages";

export type Locale = "zh-CN" | "en-US";
const BROWSER_LOCALE_KEY = "linkresume.interface-locale";
function browserLocale(): Locale {
  try { return localStorage.getItem(BROWSER_LOCALE_KEY) === "en-US" ? "en-US" : "zh-CN"; } catch { return "zh-CN"; }
}
let locale: Locale = browserLocale();
if (typeof document !== "undefined") document.documentElement.lang = locale;
const listeners = new Set<() => void>();
let revision = 0;
export function getLocaleRevision() { return revision; }
export function getLocale(): Locale { return locale; }
export function setLocale(next: Locale, persist = true) {
  if (persist) { try { localStorage.setItem(BROWSER_LOCALE_KEY, next); } catch { /* private browsing */ } }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  if (next === locale) return;
  locale = next;
  revision += 1;
  for (const listener of listeners) listener();
}
export function useLocale() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getLocale, () => "zh-CN" as Locale);
}
/** Only call with an application-owned UI message; never with user content. */
export function t(message: string, values: Record<string, string | number | null | undefined> = {}): string {
  const template = locale === "en-US" ? messages[message] ?? message : message;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}
export function formatDate(value: string | Date, options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" }) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, options).format(date);
}

/** Calendar headings, in Sunday-first order. */
export function weekdays(): string[] { return Array.from({ length: 7 }, (_, day) => weekdayName(day)); }
export function weekdayName(day: Date | number): string {
  const date = typeof day === "number" ? new Date(2023, 0, 1 + day) : day;
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
}
