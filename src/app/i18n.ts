import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import common from "@/locales/en/common.json";
import errors from "@/locales/en/errors.json";
import nav from "@/locales/en/nav.json";
import onboarding from "@/locales/en/onboarding.json";
import palette from "@/locales/en/palette.json";
import settings from "@/locales/en/settings.json";

/**
 * English is bundled statically. With one locale, lazy loading adds a loading
 * state and a failure mode in exchange for nothing. When a second locale
 * arrives, this is where a resource backend goes.
 */
void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common", "nav", "settings", "onboarding", "errors", "palette"],
  resources: { en: { common, nav, settings, onboarding, errors, palette } },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
