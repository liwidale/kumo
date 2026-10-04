import { createRoot } from 'react-dom/client'
import { boot } from '../shared/boot'
import { platformClass } from '../shared/hooks'
import '../styles/tokens.css'
import '../styles/island.css'

platformClass()
void boot().then(async () => {
  const { App } = await import('./App')
  createRoot(document.getElementById('root')!).render(<App />)
})
