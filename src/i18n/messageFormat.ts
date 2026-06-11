import IntlMessageFormat from "intl-messageformat";
import type { LocaleCode, TranslationValues } from "./types";

const formatCache = new Map<string, IntlMessageFormat>();

function getCacheKey(locale: LocaleCode, key: string, message: string): string {
  return `${locale}::${key}::${message}`;
}

export function formatIcuMessage(
  locale: LocaleCode,
  key: string,
  message: string,
  values?: TranslationValues,
): string {
  try {
    const cacheKey = getCacheKey(locale, key, message);
    let compiled = formatCache.get(cacheKey);
    if (!compiled) {
      compiled = new IntlMessageFormat(message, locale);
      formatCache.set(cacheKey, compiled);
    }
    return compiled.format(values) as string;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] Failed to format message "${key}" for locale "${locale}".`, error);
    }
    return message;
  }
}
