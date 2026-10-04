import { createRoot } from 'react-dom/client'
import { platformClass } from '../shared/hooks'
import '../styles/tokens.css'
import '../styles/launcher.css'
import { LauncherApp } from './LauncherApp'

platformClass()
createRoot(document.getElementById('root')!).render(<LauncherApp />)
