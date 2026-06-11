import { SUPPORTED_LOCALES, type LocaleCode } from "./types";

function normalizeLocaleTag(input: string): string {
  return input.trim().replace(/_/g, "-").toLowerCase();
}

export function isSupportedLocale(value: string): value is LocaleCode {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function resolveSupportedLocale(input: string | null | undefined): LocaleCode | null {
  if (!input) return null;
  const normalized = normalizeLocaleTag(input);
  if (isSupportedLocale(normalized)) return normalized;

  const [language] = normalized.split("-");
  return language && isSupportedLocale(language) ? language : null;
}

export function detectSystemLocale(): LocaleCode {
  if (typeof navigator === "undefined") return "en";
  return resolveSupportedLocale(navigator.language) ?? "en";
}
