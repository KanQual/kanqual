import { en } from "./locales/en";

export const SUPPORTED_LOCALES = ["en", "asterisk"] as const;

export const LOCALE_LABELS: Record<LocaleCode, string> = {
  en: "English",
  asterisk: "*****",
};

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

type WidenLeafStrings<TValue> =
  TValue extends string
    ? string
    : TValue extends Record<string, unknown>
      ? { [TKey in keyof TValue]: WidenLeafStrings<TValue[TKey]> }
      : TValue;

export type TranslationSchema = WidenLeafStrings<typeof en>;

type JoinPath<Prefix extends string, Key extends string> = Prefix extends "" ? Key : `${Prefix}.${Key}`;

type NestedLeafPaths<TValue, Prefix extends string = ""> =
  TValue extends string
    ? Prefix
    : TValue extends Record<string, unknown>
      ? {
          [TKey in keyof TValue & string]: NestedLeafPaths<TValue[TKey], JoinPath<Prefix, TKey>>;
        }[keyof TValue & string]
      : never;

export type TranslationKey = NestedLeafPaths<TranslationSchema>;

export type TranslationValues = Record<string, string | number | boolean | Date | null | undefined>;
