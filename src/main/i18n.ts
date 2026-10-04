import { app } from 'electron'
import { resolveLang, translate } from '../shared/i18n'
import { settings } from './settings'

export const tr = (key: string, ...args: unknown[]): string => translate(resolveLang(settings.get().language, app.getLocale()), key, args)
