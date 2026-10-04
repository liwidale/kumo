import { setLang } from './i18n'

export async function boot(): Promise<void> {
  const s = await window.kumo.settings()
  setLang(s.language)
}
