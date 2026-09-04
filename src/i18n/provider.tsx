import {
  createContext,
  useCallback,
  useEffect,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { readAppSettings, saveAppSettings } from "../lib/appSettings";
import {
  getPostgresAuthStatus,
  getPostgresUserPreferences,
  savePostgresUserPreferences,
} from "../lib/postgres";
import {
  formatDate,
  formatDateTime,
  formatList,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  type ListFormatterOptions,
} from "./formatters";
import { detectSystemLocale, resolveSupportedLocale } from "./localeDetection";
import { en } from "./locales/en";
import { formatIcuMessage } from "./messageFormat";
import type { LocaleCode, TranslationKey, TranslationSchema, TranslationValues } from "./types";

const dictionaries: Partial<Record<LocaleCode, TranslationSchema>> = {
  en,
};

const localeLoaders: Partial<Record<LocaleCode, () => Promise<TranslationSchema>>> = {};

function getValueAtPath(schema: TranslationSchema, key: TranslationKey): string | null {
  const parts = key.split(".");
  let current: unknown = schema;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : null;
}

export type I18nContextValue = {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatDate: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatPercent: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatList: (value: string[], options?: ListFormatterOptions) => string;
  formatRelativeTime: (
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export type I18nProviderProps = PropsWithChildren<{
  initialLocale?: string | null;
}>;

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<LocaleCode>(() => {
    const savedLocale = readAppSettings().ui.locale;
    return resolveSupportedLocale(initialLocale)
      ?? resolveSupportedLocale(savedLocale)
      ?? detectSystemLocale();
  });
  const [loadedDictionaries, setLoadedDictionaries] = useState<Partial<Record<LocaleCode, TranslationSchema>>>(dictionaries);

  const ensureLocaleLoaded = useCallback(async (localeCode: LocaleCode) => {
    if (loadedDictionaries[localeCode]) return;
    const loader = localeLoaders[localeCode];
    if (!loader) return;
    const dictionary = await loader();
    setLoadedDictionaries((current) => {
      if (current[localeCode]) return current;
      return {
        ...current,
        [localeCode]: dictionary,
      };
    });
  }, [loadedDictionaries]);

  useEffect(() => {
    const resolvedInitialLocale = resolveSupportedLocale(initialLocale);
    if (resolvedInitialLocale && resolvedInitialLocale !== locale) {
      setLocaleState(resolvedInitialLocale);
    }
  }, [initialLocale, locale]);

  useEffect(() => {
    let cancelled = false;

    async function loadPostgresLocalePreference() {
      try {
        const authStatus = await getPostgresAuthStatus();
        if (!authStatus.currentSession) return;
        const preferences = await getPostgresUserPreferences();
        const nextLocale = resolveSupportedLocale(preferences.locale);
        if (!cancelled && nextLocale && nextLocale !== locale) {
          setLocaleState(nextLocale);
        }
      } catch {
        // Fall back to the legacy frontend setting when PostgreSQL auth is unavailable.
      }
    }

    void loadPostgresLocalePreference();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key == null) return;
      const nextLocale = resolveSupportedLocale(readAppSettings().ui.locale);
      if (nextLocale && nextLocale !== locale) {
        setLocaleState(nextLocale);
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [locale]);

  useEffect(() => {
    void ensureLocaleLoaded(locale);
  }, [ensureLocaleLoaded, locale]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
  }, [locale]);

  function setLocale(localeCode: LocaleCode) {
    setLocaleState(localeCode);
    const settings = readAppSettings();
    if (settings.ui.locale !== localeCode) {
      saveAppSettings({
        ...settings,
        ui: {
          ...settings.ui,
          locale: localeCode,
        },
      });
    }
    void (async () => {
      try {
        const authStatus = await getPostgresAuthStatus();
        if (!authStatus.currentSession) return;
        const preferences = await getPostgresUserPreferences();
        if (preferences.locale === localeCode) return;
        await savePostgresUserPreferences({
          ...preferences,
          locale: localeCode,
        });
      } catch {
        // Keep locale switching resilient when PostgreSQL auth is not active.
      }
    })();
  }

  const value = useMemo<I18nContextValue>(() => {
    const activeDictionary = loadedDictionaries[locale] ?? en;

    function t(key: TranslationKey, values?: TranslationValues): string {
      const message = getValueAtPath(activeDictionary, key) ?? getValueAtPath(en, key);
      if (!message) {
        if (import.meta.env.DEV) {
          console.warn(`[i18n] Missing translation key "${key}" for locale "${locale}".`);
        }
        return key;
      }
      return formatIcuMessage(locale, key, message, values);
    }

    return {
      locale,
      setLocale,
      t,
      formatDate: (value, options) => formatDate(locale, value, options),
      formatDateTime: (value, options) => formatDateTime(locale, value, options),
      formatNumber: (value, options) => formatNumber(locale, value, options),
      formatPercent: (value, options) => formatPercent(locale, value, options),
      formatList: (value, options) => formatList(locale, value, options),
      formatRelativeTime: (value, unit, options) => formatRelativeTime(locale, value, unit, options),
    };
  }, [loadedDictionaries, locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
