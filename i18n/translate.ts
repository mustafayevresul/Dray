import en from "./locales/en.json";
import az from "./locales/az.json";
import tr from "./locales/tr.json";
import ru from "./locales/ru.json";
import ka from "./locales/ka.json";

// Azerbaijani is the primary/default locale per the product spec.
export const SUPPORTED_LOCALES = ["az", "tr", "ru", "ka", "en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "az";

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  az: "Azərbaycanca",
  tr: "Türkçe",
  ru: "Русский",
  ka: "ქართული",
  en: "English",
};

// `en` is the structural source of truth: every other dictionary should
// have the same key shape. Typing it this way means a missing key in
// az/tr/ru/ka surfaces as a TypeScript error, not a silent blank string
// at runtime.
type Dictionary = typeof en;

const DICTIONARIES: Record<SupportedLocale, Dictionary> = { en, az, tr, ru, ka };

type DotPath<T, Prefix extends string = ""> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object
        ? DotPath<T[K], `${Prefix}${K}.`>
        : `${Prefix}${K}`;
    }[keyof T & string]
  : never;

export type TranslationKey = DotPath<Dictionary>;

function resolveKey(dict: Dictionary, key: string): string | undefined {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object" && part in node) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict) as string | undefined;
}

/**
 * translate("loadForm.broadcastResult", { count: 4 }, "az")
 * -> "4 yaxın sürücüyə göndərildi. ..."
 *
 * Falls back to English, then to the raw key, so a missing translation
 * never crashes the UI — it just shows the English (or the key itself)
 * until the dictionary is filled in.
 */
export function translate(
  key: TranslationKey,
  vars: Record<string, string | number> | undefined,
  locale: SupportedLocale
): string {
  const dict = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const template = resolveKey(dict, key) ?? resolveKey(DICTIONARIES.en, key) ?? key;

  if (!vars) return template;
  return Object.entries(vars).reduce(
    (str, [varKey, value]) => str.replaceAll(`{{${varKey}}}`, String(value)),
    template
  );
}
