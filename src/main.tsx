import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { AuthProvider } from './state/AuthContext';
import { OrgProvider } from './state/OrgContext';
import { ToastProvider } from './state/ToastContext';
import { PeopleProvider } from './state/PeopleContext';
import { startSyncMonitor } from './lib/sync';
import { applyTheme } from './lib/theme';
import './styles.css';

applyTheme();
startSyncMonitor();
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <OrgProvider>
            <PeopleProvider>
              <App />
            </PeopleProvider>
          </OrgProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
