import { useState } from 'react';
import type { TestRequestScopeModuleSummary } from '../../types';
import { Button } from '../../components/ui/button';

export interface ScopeModuleBatchAction {
  included: boolean;
  strategy?: 'AI_RECOMMENDED' | 'ALL';
}

/** 当前模块的全量摘要和批量操作；实际写入由工作台统一排队。 */
export function QualityScopeModuleOverview({
  summary,
  disabled = false,
  pending = false,
  onBatch,
}: {
  summary: TestRequestScopeModuleSummary;
  disabled?: boolean;
  pending?: boolean;
  onBatch: (action: ScopeModuleBatchAction) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const status = summary.status === 'ALL' ? '已全部纳入' : summary.status === 'PARTIAL' ? '部分纳入' : '未纳入';
  const busy = disabled || pending;

  return <section aria-label={`模块范围 ${summary.moduleName}`} className="space-y-3 rounded-md border bg-muted/20 p-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-medium">{summary.moduleName}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{status} · 已纳入 {summary.includedCount} / {summary.totalCount} 条 · AI 推荐 {summary.aiRecommendedCount} 条 · 待处理例外 {summary.exceptionCount} 条</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => onBatch({ included: true, strategy: 'AI_RECOMMENDED' })}>{pending ? '保存中…' : '纳入 AI 推荐'}</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>移除全部</Button>
      </div>
    </div>
    {confirming ? <div role="alertdialog" aria-label="确认移除模块" className="space-y-3 rounded border border-destructive/30 bg-background p-3 text-sm">
      <p>确定移除「{summary.moduleName}」中的全部 {summary.includedCount} 条已纳入用例吗？</p>
      <p className="text-xs text-muted-foreground">移除后仍可通过“纳入 AI 推荐”恢复 AI 推荐的候选。</p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>取消</Button>
        <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => { setConfirming(false); onBatch({ included: false }); }}>移除全部</Button>
      </div>
    </div> : null}
  </section>;
}
