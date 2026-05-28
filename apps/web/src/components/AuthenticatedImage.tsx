import { useEffect, useState } from 'react';
import { authTokenStorageKey } from '../api';
import { cn } from '../lib/utils';

interface AuthenticatedImageProps {
  src: string;
  alt: string;
  className?: string;
}

export function AuthenticatedImage({ src, alt, className }: AuthenticatedImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      const token = localStorage.getItem(authTokenStorageKey) ?? '';
      const response = await fetch(src, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok || cancelled) {
        return;
      }

      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) {
        setBlobUrl(objectUrl);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  if (!blobUrl) {
    return <div className={cn('rounded-lg border border-border bg-muted', className)} aria-hidden="true" />;
  }

  return <img src={blobUrl} alt={alt} className={className} />;
}
