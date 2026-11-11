import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { PersonaProvider } from './persona'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing root')

createRoot(root).render(
  <StrictMode>
    <PersonaProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersonaProvider>
  </StrictMode>,
)
