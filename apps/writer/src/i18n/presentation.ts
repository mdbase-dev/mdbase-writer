import { formatters } from "@mdbase-dev/i18n";
import { i18n } from "./app.js";

/** Interface formatting only; document metadata and exported prose keep their own locale. */
export const intlLocale = () => i18n.locale === "pt" ? "pt-BR" : i18n.locale === "zh" ? "zh-CN" : i18n.locale;
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => formatters(i18n.locale).number(value, options);
export const formatDate = (value: Date | number, options?: Intl.DateTimeFormatOptions) => formatters(i18n.locale).date(value, options);
export const formatRelative = (value: number, unit: Intl.RelativeTimeFormatUnit) => formatters(i18n.locale).relativeTime(value, unit, { numeric: "auto" });
