import { createContext, useContext, useState, type ReactNode } from 'react'
import { zh, type Translations } from './zh'
import { en } from './en'

export type Language = 'zh' | 'en'

const STORAGE_KEY = 'linkcv-lang'

const translations: Record<Language, Translations> = { zh, en }

interface LanguageContextValue {
  lang: Language
  toggle: () => void
  t: Translations
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'zh',
  toggle: () => {},
  t: zh,
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh'
    } catch {
      return 'zh'
    }
  })

  const toggle = () => {
    setLang((current) => {
      const next = current === 'zh' ? 'en' : 'zh'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // localStorage may be unavailable
      }
      return next
    })
  }

  return (
    <LanguageContext.Provider value={{ lang, toggle, t: translations[lang] }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

export function useT() {
  return useContext(LanguageContext).t
}
