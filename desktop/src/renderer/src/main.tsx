import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

window.desktop?.onSpeak((message) => {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(message))
})
import './styles.css'
import './settings.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
