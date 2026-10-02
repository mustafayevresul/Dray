import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  SupportedLocale,
  TranslationKey,
  translate,
} from "../../i18n/translate";
import { api } from "../services/api";

const STORAGE_KEY = "freight_app_locale";

type LocaleContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale, driverId?: string) => Promise<void>;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function detectDeviceLocale(): SupportedLocale {
  const deviceTag = Localization.getLocales()[0]?.languageCode; // e.g. "az", "tr", "ru", "ka", "en", or something unsupported
  return (SUPPORTED_LOCALES as readonly string[]).includes(deviceTag ?? "")
    ? (deviceTag as SupportedLocale)
    : DEFAULT_LOCALE;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
        setLocaleState(stored as SupportedLocale);
      } else {
        setLocaleState(detectDeviceLocale());
      }
    })();
  }, []);

  const setLocale = useCallback(async (next: SupportedLocale, driverId?: string) => {
    setLocaleState(next);
    await AsyncStorage.setItem(STORAGE_KEY, next);
    // Best-effort sync to the backend so server-rendered notification copy
    // (see lib/push.ts) matches the driver's chosen language too.
    if (driverId) {
      api.updateDriverLocale(driverId, next).catch(() => {
        /* non-fatal: local UI already reflects the new language */
      });
    }
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
