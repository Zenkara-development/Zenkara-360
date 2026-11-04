import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Optional custom fallback. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center mb-4">
          <AlertTriangle size={24} className="text-amber-500 dark:text-amber-400" />
        </div>
        <h2 className="text-lg font-semibold text-fg mb-1">Something went wrong</h2>
        <p className="text-sm text-fg-muted mb-1 max-w-sm">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <p className="text-xs text-fg-subtle mb-5">
          Try refreshing the page, or click the button below to retry.
        </p>
        <button
          onClick={this.reset}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    );
  }
}
