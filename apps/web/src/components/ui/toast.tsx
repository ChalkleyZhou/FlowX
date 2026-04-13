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
      <div className="fixed right-5 top-5 z-80 flex max-w-[min(360px,calc(100vw-24px))] flex-col gap-2.5">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={[
              'flex items-center gap-3 rounded-md border border-border bg-surface/94 px-3.5 py-3 shadow-md backdrop-blur-[10px]',
              toast.variant === 'success' && 'border-success/18',
              toast.variant === 'error' && 'border-danger/18',
            ].filter(Boolean).join(' ')}
          >
            <div className={[
              'grid shrink-0 place-items-center',
              toast.variant === 'success' && 'text-success',
              toast.variant === 'error' && 'text-danger',
              toast.variant !== 'success' && toast.variant !== 'error' && 'text-primary',
            ].filter(Boolean).join(' ')}>{getToastIcon(toast.variant)}</div>
            <div className="min-w-0 flex-1 text-base leading-6 text-foreground">{toast.title}</div>
            <button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-full bg-transparent text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
              onClick={() => removeToast(toast.id)}
              aria-label="关闭提示"
            >
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
