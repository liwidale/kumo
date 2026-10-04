import { createRoot } from 'react-dom/client'
import { boot } from '../shared/boot'
import { platformClass } from '../shared/hooks'
import '../styles/tokens.css'
import '../styles/launcher.css'

platformClass()
void boot().then(async () => {
  const { LauncherApp } = await import('./LauncherApp')
  createRoot(document.getElementById('root')!).render(<LauncherApp />)
})
