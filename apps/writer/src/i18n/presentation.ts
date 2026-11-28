import { formatters } from "@mdbase-dev/i18n";
import { i18n } from "./app.js";

/** Interface formatting only; document metadata and exported prose keep their own locale. */
export const intlLocale = () => i18n.locale === "pt" ? "pt-BR" : i18n.locale === "zh" ? "zh-CN" : i18n.locale;
const countFormats = new Map<string, Intl.NumberFormat>();
export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  if (options) return formatters(i18n.locale).number(value, options);
  const locale = intlLocale();
  let formatter = countFormats.get(locale);
  if (!formatter) { formatter = new Intl.NumberFormat(locale); countFormats.set(locale, formatter); }
  return formatter.format(value);
}
export const formatDate = (value: Date | number, options?: Intl.DateTimeFormatOptions) => formatters(i18n.locale).date(value, options);
export const formatRelative = (value: number, unit: Intl.RelativeTimeFormatUnit) => formatters(i18n.locale).relativeTime(value, unit, { numeric: "auto" });
