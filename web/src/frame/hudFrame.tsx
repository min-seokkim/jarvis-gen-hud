import { createRoot } from 'react-dom/client';
import { FrameApp } from './FrameApp';
import { post } from './post';
import '../styles/tokens.css';
import '../hud/styles.css';
import './frame.css';

/**
 * Entry of the sandboxed HUD frame. Generated JSX is evaluated only here,
 * inside an opaque-origin iframe (sandbox="allow-scripts") whose CSP blocks
 * all network access, so a validator bypass cannot reach the app, its
 * storage, or the authenticated /v1 endpoint.
 *
 * Built as a single classic IIFE script (vite.hudframe.config.ts): module
 * scripts are CORS-fetched without credentials and would 401 behind the
 * deployment's basic-auth, while classic scripts load with credentials.
 */

window.addEventListener('error', (event) => {
  post({
    type: 'hud:error',
    message: event.message || 'HUD frame script error.',
  });
});

window.addEventListener('unhandledrejection', () => {
  post({ type: 'hud:error', message: 'HUD frame unhandled rejection.' });
});

createRoot(document.getElementById('root')!).render(<FrameApp />);
