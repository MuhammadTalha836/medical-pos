import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
// Applies the saved light/dark theme before the first render (login screen included)
import './store/useThemeStore';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
