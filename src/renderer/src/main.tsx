import { createRoot } from 'react-dom/client'
import { App } from './App'
import { UIProvider } from './ui'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <UIProvider>
    <App />
  </UIProvider>
)
