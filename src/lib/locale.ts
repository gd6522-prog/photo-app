import AsyncStorage from "@react-native-async-storage/async-storage";

export type AppLocale = "ko" | "en" | "ja" | "zh";

export const LOCALE_KEY = "app_locale";

let currentLocale: AppLocale = "ko";

export function getLocale(): AppLocale {
  return currentLocale;
}

export function localeFromNationality(nationality: string): AppLocale {
  const code = (nationality || "").toUpperCase().trim();

  if (code === "KR") return "ko";

  if (["US", "UK", "CA", "AU", "NZ"].includes(code)) return "en";

  if (code === "JP") return "ja";

  if (["CN", "TW", "HK", "MO"].includes(code)) return "zh";

  // 그 외는 영어로
  return "en";
}

export async function setLocale(locale: AppLocale) {
  currentLocale = locale;
  await AsyncStorage.setItem(LOCALE_KEY, locale);
}

export async function loadLocale(): Promise<AppLocale> {
  const saved = (await AsyncStorage.getItem(LOCALE_KEY)) as AppLocale | null;
  if (saved) currentLocale = saved;
  return currentLocale;
}
