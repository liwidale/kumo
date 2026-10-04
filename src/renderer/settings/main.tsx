import { createRoot } from 'react-dom/client'
import { platformClass } from '../shared/hooks'
import '../styles/tokens.css'
import '../styles/settings.css'
import { SettingsApp } from './SettingsApp'

platformClass()
createRoot(document.getElementById('root')!).render(<SettingsApp />)
