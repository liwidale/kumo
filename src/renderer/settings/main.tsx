import { createRoot } from 'react-dom/client'
import { boot } from '../shared/boot'
import { platformClass } from '../shared/hooks'
import '../styles/tokens.css'
import '../styles/settings.css'

platformClass()
void boot().then(async () => {
  const { SettingsApp } = await import('./SettingsApp')
  createRoot(document.getElementById('root')!).render(<SettingsApp />)
})
