import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { ThemeProvider } from './contexts/ThemeContext';
// Renders the toastStore. Without this mounted, every addToast() call in the
// app pushed into a store with no subscriber and the user saw nothing.
import { ToastContainer } from './shared/components/ToastContainer';
// Top-level crash net. AppLayout has its own ErrorBoundary around the routed
// pages, but a render crash in LoginPage, the customer portal, or AppLayout's
// own chrome (sidebar/header) happened OUTSIDE that boundary — the user got a
// blank white screen with no way back. This outer boundary is the fallback
// for everything the inner one can't see.
import { ErrorBoundary } from './shared/components/ErrorBoundary';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      // Network-aware retry. A response with an error status (4xx/5xx) is a
      // real answer — retrying it once (the old behavior) is plenty. NO
      // response at all usually means the free-tier backend is cold-starting
      // (50–90s on Render's free plan after it spins down), so those get
      // more attempts with growing delays instead of failing the screen
      // while the server is still booting. ServerWakingOverlay (App.tsx)
      // shows what's happening and refetches everything once it's awake.
      retry: (failureCount, error: any) => {
        if (!error?.response) return failureCount < 5;
        return failureCount < 1;
      },
      retryDelay: attempt => Math.min(2000 * 2 ** attempt, 15_000),
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          {/* Derived from Vite's `base` (see vite.config.ts) so the router
              and the asset URLs can never disagree. BASE_URL is '/' for the
              Capacitor build and '/zenkara/' when the web build is hosted
              under a path; React Router wants no trailing slash, and ''
              means "no basename", which is exactly right at the root. */}
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <App />
            <ToastContainer />
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
