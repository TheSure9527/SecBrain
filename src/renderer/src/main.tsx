import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles.css'
import './calendar.css'
import './pickers.css'
import './tasks.css'
import './butler.css'
import './file-tree.css'
import './theme.css'
import './viewer.css'
import './links.css'
import './markdown.css'
import './daily.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
