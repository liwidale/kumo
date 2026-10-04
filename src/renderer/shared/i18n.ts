import { resolveLang, translate, type Lang } from '../../shared/i18n'

let lang: Lang = 'en'

export function setLang(setting: string | undefined): Lang {
  lang = resolveLang(setting, navigator.language)
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
  return lang
}

export const currentLang = (): Lang => lang

export const tr = (key: string, ...args: unknown[]): string => translate(lang, key, args)
