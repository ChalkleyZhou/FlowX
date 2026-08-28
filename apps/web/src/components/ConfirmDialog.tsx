import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';

export interface ConfirmOptions {
  title?: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface PendingConfirmation extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

type ConfirmContextValue = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setPending((current) => {
      current?.resolve(false);
      return { ...options, resolve };
    });
  }), []);

  const settle = useCallback((confirmed: boolean) => {
    setPending((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(open) => {
        if (!open) {
          settle(false);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pending?.destructive ? (
                <AlertTriangle aria-hidden="true" className="h-5 w-5 text-danger" />
              ) : null}
              {pending?.title ?? '确认操作'}
            </DialogTitle>
            <DialogDescription>{pending?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => settle(false)}>
              {pending?.cancelLabel ?? '取消'}
            </Button>
            <Button
              type="button"
              variant={pending?.destructive ? 'destructive' : 'default'}
              onClick={() => settle(true)}
            >
              {pending?.confirmLabel ?? '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within ConfirmProvider');
  }
  return context;
}
