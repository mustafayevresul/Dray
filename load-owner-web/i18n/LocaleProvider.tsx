"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  SupportedLocale,
  TranslationKey,
  translate,
  LOCALE_LABELS,
} from "../../i18n/translate";

const STORAGE_KEY = "freight_app_locale";

type LocaleContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      setLocaleState(stored as SupportedLocale);
    }
  }, []);

  const setLocale = useCallback((next: SupportedLocale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => translate(key, vars, locale),
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useTranslation must be used within a LocaleProvider");
  return ctx;
}

export function LanguageSelect() {
  const { locale, setLocale } = useTranslation();
  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as SupportedLocale)}
      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
      aria-label="Language"
    >
      {SUPPORTED_LOCALES.map((code) => (
        <option key={code} value={code}>
          {LOCALE_LABELS[code]}
        </option>
      ))}
    </select>
  );
}
