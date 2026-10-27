export const locales = ["en", "de", "pirate"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const LOCALE_COOKIE = "pp_locale";

/** Native names shown in the language switcher. */
export const localeNames: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  pirate: "🏴‍☠️ Pirate",
};

/** BCP 47 tag for <html lang> and Intl formatting. Pirate formats like English. */
export const localeTags: Record<Locale, { lang: string; intl: string }> = {
  en: { lang: "en", intl: "en-CH" },
  de: { lang: "de-CH", intl: "de-CH" },
  pirate: { lang: "en-x-pirate", intl: "en-CH" },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
