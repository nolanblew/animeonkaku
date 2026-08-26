import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './app/App'
import { AppQueryProvider } from './lib/query'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppQueryProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppQueryProvider>
  </StrictMode>,
)
