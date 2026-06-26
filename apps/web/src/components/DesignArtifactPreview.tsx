import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../api';
import type { WorkflowDesignArtifact } from '../types';
import { Button } from './ui/button';

interface Props {
  workflowRunId: string;
  /** Bump this value (e.g. on stage status change) to force a reload after a new design is generated. */
  reloadKey?: string | number;
}

/**
 * Read-only preview of the OpenDesign high-fidelity HTML design artifact, rendered in a sandboxed iframe.
 * The iframe is sandboxed (no scripts, no same-origin) so untrusted generated HTML cannot touch the app.
 */
export function DesignArtifactPreview({ workflowRunId, reloadKey }: Props) {
  const [artifact, setArtifact] = useState<WorkflowDesignArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getWorkflowDesignArtifact(workflowRunId);
      setArtifact(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载设计稿失败');
    } finally {
      setLoading(false);
    }
  }, [workflowRunId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const openInNewWindow = useCallback(() => {
    if (!artifact?.html) {
      return;
    }
    const blob = new Blob([artifact.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [artifact]);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          OpenDesign 高保真设计稿
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} aria-label="刷新设计稿">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={openInNewWindow}
            disabled={!artifact?.html}
            aria-label="在新窗口打开设计稿"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      {artifact?.generatedAt && (
        <p className="text-xs text-muted-foreground">生成于 {new Date(artifact.generatedAt).toLocaleString()}</p>
      )}

      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : loading && !artifact ? (
        <p className="text-sm text-muted-foreground">设计稿加载中…</p>
      ) : artifact?.html ? (
        <iframe
          title="OpenDesign 设计稿预览"
          sandbox=""
          srcDoc={artifact.html}
          className="h-[640px] w-full rounded-md border border-border bg-white"
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          暂无高保真设计稿。点击「AI 生成设计方案」后，OpenDesign 会产出可预览的单页设计稿。
        </p>
      )}
    </div>
  );
}
