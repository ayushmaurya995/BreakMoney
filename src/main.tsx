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
  import('./Landing')
    .then(({ default: Landing }) => {
      root.render(
        <React.StrictMode>
          <Landing
            onGetStarted={() => showMessage(
              'Firebase setup required',
              'The BreakMoney landing page is ready, but sign-up cannot start until the Firebase web configuration is included in the production build.',
              'Missing: ' + missingKeys.join(', ') + '. Add these in Vercel → Project Settings → Environment Variables, select Production, then redeploy.'
            )}
            onSignIn={() => showMessage(
              'Firebase setup required',
              'Sign-in is temporarily unavailable until the Firebase configuration is included in the production build.',
              'Missing: ' + missingKeys.join(', ') + '. Add these in Vercel → Project Settings → Environment Variables, select Production, then redeploy.'
            )}
          />
        </React.StrictMode>
      );
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      showMessage('BreakMoney could not start', 'The landing page failed to load.', detail);
      console.error('BreakMoney landing startup failed:', error);
    });
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
