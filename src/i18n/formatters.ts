import { DEFAULT_APP_SETTINGS, readAppSettings } from "../lib/appSettings";
import { detectSystemLocale, resolveSupportedLocale } from "./localeDetection";
import type { LocaleCode } from "./types";

export type ListFormatterOptions = {
  localeMatcher?: "best fit" | "lookup";
  style?: "long" | "short" | "narrow";
  type?: "conjunction" | "disjunction" | "unit";
};

type IntlWithOptionalListFormat = typeof Intl & {
  ListFormat?: new (
    locales?: string | string[],
    options?: ListFormatterOptions,
  ) => {
    format(values: string[]): string;
  };
};

function getCurrentLocale(): LocaleCode {
  if (typeof window === "undefined") return "en";
  try {
    const savedLocale = readAppSettings().ui.locale;
    return resolveSupportedLocale(savedLocale) ?? detectSystemLocale() ?? DEFAULT_APP_SETTINGS.ui.locale;
  } catch {
    return detectSystemLocale() ?? DEFAULT_APP_SETTINGS.ui.locale;
  }
}

export function formatDate(locale: LocaleCode, value: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(value));
}

export function formatDateTime(locale: LocaleCode, value: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
  const hasExplicitDateOrTimeFields = Boolean(
    options
    && (
      "weekday" in options
      || "era" in options
      || "year" in options
      || "month" in options
      || "day" in options
      || "dayPeriod" in options
      || "hour" in options
      || "minute" in options
      || "second" in options
      || "fractionalSecondDigits" in options
      || "timeZoneName" in options
    ),
  );

  const shouldForceSeconds = Boolean(
    options
    && (
      "hour" in options
      || "minute" in options
      || "dayPeriod" in options
      || "timeStyle" in options
    )
    && !("second" in options)
    && !("fractionalSecondDigits" in options),
  );

  const resolvedOptions: Intl.DateTimeFormatOptions | undefined = hasExplicitDateOrTimeFields
    ? {
        ...options,
        ...(shouldForceSeconds ? { second: "2-digit" as const } : {}),
        ...(options?.timeStyle === "short" ? { timeStyle: "medium" as const } : {}),
      }
    : {
        dateStyle: "medium",
        timeStyle: "medium",
        ...options,
      };

  return new Intl.DateTimeFormat(locale, resolvedOptions).format(new Date(value));
}

export function formatCurrentDate(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
  return formatDate(getCurrentLocale(), value, options);
}

export function formatCurrentDateTime(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
  return formatDateTime(getCurrentLocale(), value, options);
}

export function formatNumber(locale: LocaleCode, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatCurrentNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return formatNumber(getCurrentLocale(), value, options);
}

export function formatPercent(locale: LocaleCode, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
    ...options,
  }).format(value);
}

export function formatList(locale: LocaleCode, value: string[], options?: ListFormatterOptions): string {
  const intlWithListFormat = Intl as IntlWithOptionalListFormat;
  if (intlWithListFormat.ListFormat) {
    return new intlWithListFormat.ListFormat(locale, options).format(value);
  }
  if (value.length <= 1) return value[0] ?? "";
  if (value.length === 2) return `${value[0]} and ${value[1]}`;
  return `${value.slice(0, -1).join(", ")}, and ${value[value.length - 1]}`;
}

export function formatRelativeTime(
  locale: LocaleCode,
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options?: Intl.RelativeTimeFormatOptions,
): string {
  return new Intl.RelativeTimeFormat(locale, options).format(value, unit);
}
