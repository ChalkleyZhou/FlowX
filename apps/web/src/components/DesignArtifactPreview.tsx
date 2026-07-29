import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../api';
import type { DesignSurfaceInventory, WorkflowDesignArtifactPage } from '../types';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

interface Props {
  workflowRunId: string;
  /** Bump this value (e.g. on stage status change) to force a reload after a new design is generated. */
  reloadKey?: string | number;
}

/**
 * 多端多页设计稿预览：动态端 Tab + 页列表 + sandboxed iframe。
 * Scripts 允许交互稿渲染；禁止 same-origin，避免未信任 HTML 访问 FlowX。
 */
export function DesignArtifactPreview({ workflowRunId, reloadKey }: Props) {
  const [surfaces, setSurfaces] = useState<DesignSurfaceInventory[]>([]);
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [page, setPage] = useState<WorkflowDesignArtifactPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedSurface = surfaces.find((surface) => surface.id === selectedSurfaceId) ?? null;

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listWorkflowDesignArtifacts(workflowRunId);
      const nextSurfaces = result.surfaces ?? [];
      setSurfaces(nextSurfaces);
      const firstSurface = nextSurfaces[0];
      const firstPage = firstSurface?.pages[0];
      setSelectedSurfaceId(firstSurface?.id ?? null);
      setSelectedPageId(firstPage?.id ?? null);
      if (!firstSurface || !firstPage) {
        setPage(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载设计稿失败');
      setSurfaces([]);
      setSelectedSurfaceId(null);
      setSelectedPageId(null);
      setPage(null);
    } finally {
      setLoading(false);
    }
  }, [workflowRunId]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory, reloadKey]);

  useEffect(() => {
    if (!selectedSurfaceId || !selectedPageId) {
      setPage(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.getWorkflowDesignArtifactPage(
          workflowRunId,
          selectedSurfaceId,
          selectedPageId,
        );
        if (!cancelled) {
          setPage(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setPage(null);
          setError(err instanceof Error ? err.message : '加载设计稿页面失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workflowRunId, selectedSurfaceId, selectedPageId]);

  const openInNewWindow = useCallback(() => {
    if (!page?.html) {
      return;
    }
    const blob = new Blob([page.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [page]);

  const summary =
    surfaces.length > 0
      ? surfaces.map((surface) => `${surface.id}(${surface.pages.length})`).join(' · ')
      : null;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          OpenDesign 高保真设计稿
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void loadInventory()} disabled={loading} aria-label="刷新设计稿">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={openInNewWindow}
            disabled={!page?.html}
            aria-label="在新窗口打开设计稿"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      {summary && <p className="text-xs text-muted-foreground">当前包含：{summary}</p>}

      {page?.generatedAt && (
        <p className="text-xs text-muted-foreground">生成于 {new Date(page.generatedAt).toLocaleString()}</p>
      )}

      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : loading && surfaces.length === 0 ? (
        <p className="text-sm text-muted-foreground">设计稿加载中…</p>
      ) : surfaces.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          暂无高保真设计稿。请本地回传（design/ 按端多页）或点击「AI 生成设计方案」。
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 border-b border-border pb-2" role="tablist" aria-label="设计端">
            {surfaces.map((surface) => (
              <button
                key={surface.id}
                type="button"
                role="tab"
                aria-selected={surface.id === selectedSurfaceId}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  surface.id === selectedSurfaceId
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
                onClick={() => {
                  setSelectedSurfaceId(surface.id);
                  setSelectedPageId(surface.pages[0]?.id ?? null);
                }}
              >
                {surface.id}
              </button>
            ))}
          </div>

          {selectedSurface && selectedSurface.pages.length > 0 && (
            <div className="flex flex-wrap gap-2" role="list" aria-label="设计页面">
              {selectedSurface.pages.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs transition-colors',
                    item.id === selectedPageId
                      ? 'border-primary text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setSelectedPageId(item.id)}
                >
                  {item.title ?? item.id}
                </button>
              ))}
            </div>
          )}

          {page?.html ? (
            <iframe
              title={`OpenDesign 设计稿 ${selectedSurfaceId ?? ''} / ${selectedPageId ?? ''}`}
              sandbox="allow-scripts"
              srcDoc={page.html}
              className="h-[640px] w-full rounded-md border border-border bg-card"
            />
          ) : (
            <p className="text-sm text-muted-foreground">请选择要预览的页面。</p>
          )}
        </>
      )}
    </div>
  );
}
