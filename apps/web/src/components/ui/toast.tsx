import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastVariant = 'success' | 'error';

interface ToastRecord {
  id: string;
  title: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  success: (title: string) => void;
  error: (title: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function getToastIcon(variant: ToastVariant) {
  return variant === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback((title: string, variant: ToastVariant) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current, { id, title, variant }]);
    window.setTimeout(() => {
      removeToast(id);
    }, 2800);
  }, [removeToast]);

  const value = useMemo<ToastContextValue>(() => ({
    success: (title: string) => pushToast(title, 'success'),
    error: (title: string) => pushToast(title, 'error'),
  }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast-item toast-item-${toast.variant}`}>
            <div className="toast-icon">{getToastIcon(toast.variant)}</div>
            <div className="toast-copy">{toast.title}</div>
            <button type="button" className="toast-close" onClick={() => removeToast(toast.id)} aria-label="关闭提示">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
