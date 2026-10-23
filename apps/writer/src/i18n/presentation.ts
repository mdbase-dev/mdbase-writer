import { i18n } from "./app.js";

/** Interface formatting only; document metadata and exported prose keep their own locale. */
export const intlLocale = () => i18n.locale === "pt" ? "pt-BR" : i18n.locale === "zh" ? "zh-CN" : i18n.locale;
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(intlLocale(), options).format(value);
export const formatDate = (value: Date | number, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocale(), options).format(value);
export const formatRelative = (value: number, unit: Intl.RelativeTimeFormatUnit) => new Intl.RelativeTimeFormat(intlLocale(), { numeric: "auto" }).format(value, unit);
