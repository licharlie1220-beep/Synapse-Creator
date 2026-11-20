import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  type AppLanguage,
  SUPPORTED_LANGUAGES,
  TRANSLATIONS,
} from './translations';

const LANGUAGE_STORAGE_KEY = 'creator_workbench_language_v1';

export function loadSavedLanguage(): AppLanguage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (
        saved === 'zh-CN' ||
        saved === 'en-US' ||
        saved === 'pt-BR' ||
        saved === 'th-TH'
      ) {
        return saved;
      }
    }
  } catch {
    // Ignore storage errors
  }
  return 'zh-CN';
}

export function saveLanguage(lang: AppLanguage): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      document.documentElement.setAttribute('lang', lang);
    }
    // Sync to desktop electron config if running in desktop
    if (typeof window !== 'undefined' && (window as any).electronBridge?.saveAppConfig) {
      void (window as any).electronBridge.saveAppConfig({ language: lang });
    }
  } catch {
    // Ignore storage errors
  }
}

interface I18nContextType {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType>({
  language: 'zh-CN',
  setLanguage: () => {},
  t: (k) => k,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<AppLanguage>(() => loadSavedLanguage());

  const setLanguage = (nextLang: AppLanguage) => {
    setLanguageState(nextLang);
    saveLanguage(nextLang);
  };

  useEffect(() => {
    document.documentElement.setAttribute('lang', language);
  }, [language]);

  const t = (key: string, params?: Record<string, string | number>): string => {
    const dict = TRANSLATIONS[language] || TRANSLATIONS['zh-CN'];
    let text = dict[key] || TRANSLATIONS['zh-CN'][key] || key;

    if (params) {
      for (const [pKey, pVal] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${pKey}\\}`, 'g'), String(pVal));
      }
    }
    return text;
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nContextType {
  return useContext(I18nContext);
}

export { SUPPORTED_LANGUAGES, type AppLanguage };
