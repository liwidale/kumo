import { createRoot } from 'react-dom/client'
import { platformClass } from '../shared/hooks'
import '../styles/tokens.css'
import '../styles/island.css'
import { App } from './App'

platformClass()
createRoot(document.getElementById('root')!).render(<App />)
