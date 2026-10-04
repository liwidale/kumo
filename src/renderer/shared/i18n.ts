import { resolveLang, translate, type Lang } from '../../shared/i18n'

const lang: Lang = resolveLang(window.kumo.language, navigator.language)
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang

export const currentLang = (): Lang => lang

export const tr = (key: string, ...args: unknown[]): string => translate(lang, key, args)
