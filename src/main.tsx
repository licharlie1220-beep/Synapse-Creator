import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import {I18nProvider} from './i18n/index.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <I18nProvider>
      <App />
    </I18nProvider>
  </ErrorBoundary>
);
