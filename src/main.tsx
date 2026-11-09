import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
const requiredFirebaseKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

const missingKeys = requiredFirebaseKeys.filter((key) => !import.meta.env[key]);

function showMessage(title: string, message: string, detail?: string) {
  root.render(
    <main className="auth-wrap">
      <section className="auth-card">
        <div className="brand"><b>B</b> break<span>money</span></div>
        <p className="eyebrow">APPLICATION STARTUP</p>
        <h1>{title}</h1>
        <p className="muted">{message}</p>
        {detail && <p className="error">{detail}</p>}
      </section>
    </main>
  );
}

if (missingKeys.length > 0) {
  showMessage(
    'Firebase setup required',
    'The website is deployed, but these Firebase environment variables were not included in this production build.',
    'Missing: ' + missingKeys.join(', ') + '. Add them in Vercel → Project Settings → Environment Variables, select Production, then create a new deployment.'
  );
} else {
  import('./App')
    .then(({ default: App }) => {
      root.render(<React.StrictMode><App /></React.StrictMode>);
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      showMessage(
        'BreakMoney could not start',
        'The application bundle loaded, but startup failed. Share this error with support.',
        detail
      );
      console.error('BreakMoney startup failed:', error);
    });
}
