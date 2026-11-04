import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

export function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-20 sm:py-28">
      <ShieldAlert className="w-10 h-10 text-red-500 dark:text-red-400 mb-3" />
      <h2 className="text-lg font-semibold text-fg">Access denied</h2>
      <p className="text-sm text-fg-muted mt-1 max-w-sm">
        Your role doesn't have permission to view this page. If you think this is a mistake, ask an admin to update your role.
      </p>
      <Link to="/dashboard" className="mt-5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300">
        Back to Dashboard
      </Link>
    </div>
  );
}
