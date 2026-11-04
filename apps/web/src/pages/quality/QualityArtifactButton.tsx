import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';

export function QualityArtifactButton({
  artifactId,
  name = 'evidence',
  download = false,
  children,
}: {
  artifactId: string;
  name?: string;
  download?: boolean;
  children: React.ReactNode;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url?: string; html?: string }>();
  const urls = useRef(new Set<string>());
  const timers = useRef(new Set<number>());
  const previewUrl = useRef<string | undefined>(undefined);
  const active = useRef(true);

  function release(url: string) {
    if (urls.current.delete(url)) URL.revokeObjectURL(url);
  }
  function closePreview() {
    if (previewUrl.current) release(previewUrl.current);
    previewUrl.current = undefined;
    setPreview(undefined);
  }
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      timers.current.forEach((timer) => window.clearTimeout(timer));
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      timers.current.clear();
      urls.current.clear();
    };
  }, []);

  async function open() {
    setBusy(true);
    try {
      const blob = await api.fetchArtifactContent(artifactId);
      if (!active.current) return;
      closePreview();
      if (!download && blob.type.includes('html')) {
        const html = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsText(blob);
        });
        if (active.current) setPreview({ html });
      } else {
        const url = URL.createObjectURL(blob);
        urls.current.add(url);
        if (download) {
          const link = document.createElement('a');
          link.href = url;
          link.download = name;
          link.click();
          const timer = window.setTimeout(() => {
            release(url);
            timers.current.delete(timer);
          }, 1000);
          timers.current.add(timer);
        } else {
          previewUrl.current = url;
          setPreview({ url });
        }
      }
    } catch (error) {
      if (active.current) toast.error(error instanceof Error ? error.message : '读取资料失败');
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void open()}>
        {children}
      </Button>
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) closePreview();
        }}
      >
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{name}</DialogTitle>
            <DialogDescription>仅对当前有权限的资料进行预览。</DialogDescription>
          </DialogHeader>
          <iframe
            title={name}
            sandbox=""
            src={preview?.url}
            srcDoc={preview?.html}
            className="h-[70vh] w-full rounded border"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
