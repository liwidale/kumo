import de from './locales/de'
import es from './locales/es'
import fr from './locales/fr'
import ja from './locales/ja'
import pt from './locales/pt'
import ru from './locales/ru'
import zh from './locales/zh'

export type Lang = 'en' | 'ru' | 'de' | 'fr' | 'es' | 'pt' | 'ja' | 'zh'

const DICTS: Record<Exclude<Lang, 'en'>, Record<string, string>> = { ru, de, fr, es, pt, ja, zh }

const PLURALS: Record<Lang, Intl.LDMLPluralRule[]> = {
  en: ['one', 'other'],
  ru: ['one', 'few', 'many', 'other'],
  de: ['one', 'other'],
  fr: ['one', 'other'],
  es: ['one', 'other'],
  pt: ['one', 'other'],
  ja: ['other'],
  zh: ['other'],
}

export function resolveLang(setting: string | undefined, locale: string | undefined): Lang {
  const pick = setting && setting !== 'auto' ? setting : locale || 'en'
  const base = pick.toLowerCase().split(/[-_]/)[0]
  return (['en', 'ru', 'de', 'fr', 'es', 'pt', 'ja', 'zh'] as Lang[]).includes(base as Lang) ? (base as Lang) : 'en'
}

const rules = new Map<Lang, Intl.PluralRules>()

function plural(lang: Lang, forms: string[], n: number): string {
  let r = rules.get(lang)
  if (!r) {
    r = new Intl.PluralRules(lang === 'zh' ? 'zh-CN' : lang)
    rules.set(lang, r)
  }
  const order = PLURALS[lang]
  const i = order.indexOf(r.select(n))
  return forms[i >= 0 && i < forms.length ? i : forms.length - 1]
}

export function translate(lang: Lang, key: string, args: unknown[]): string {
  const raw = lang === 'en' ? key : DICTS[lang][key] || key
  const source = raw === key && lang !== 'en' ? 'en' : lang
  let text = raw
  if (raw.includes('|')) {
    const n = typeof args[0] === 'number' ? args[0] : 0
    text = plural(source, raw.split('|'), n)
  }
  return args.length ? text.replace(/\{(\d)\}/g, (m, d: string) => (args[Number(d)] === undefined ? m : String(args[Number(d)]))) : text
}
