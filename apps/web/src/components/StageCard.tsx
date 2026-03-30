import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader } from './ui/card';
import type { ReactNode } from 'react';

interface StageAction {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  variant?: 'primary' | 'default';
}

interface StageCardProps {
  title: string;
  subtitle: string;
  status?: string;
  statusMessage?: string | null;
  attempt?: number;
  metaItems?: Array<{ key: string; label: string; value: ReactNode }>;
  output?: unknown;
  actions?: StageAction[];
}

type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

function formatStageStatus(status?: string) {
  const map: Record<string, string> = {
    COMPLETED: '已完成',
    WAITING_CONFIRMATION: '待确认',
    RUNNING: '执行中',
    FAILED: '失败',
    REJECTED: '已驳回',
    NOT_STARTED: '未开始',
  };

  return map[status ?? 'NOT_STARTED'] ?? status ?? '未开始';
}

function formatOutputLabel(key: string) {
  const map: Record<string, string> = {
    tasks: '任务列表',
    ambiguities: '待澄清项',
    risks: '风险点',
    summary: '方案摘要',
    implementationPlan: '实施步骤',
    filesToModify: '涉及文件',
    newFiles: '新增文件',
    riskPoints: '风险点',
    patchSummary: '改动摘要',
    changedFiles: '变更文件',
    codeChanges: '代码变更',
    diffArtifacts: '差异产物',
    issues: '问题项',
    bugs: '缺陷',
    missingTests: '缺失测试',
    suggestions: '建议',
    impactScope: '影响范围',
    status: '状态',
    message: '说明',
  };

  return map[key] ?? key;
}

function isRecord(value: unknown): value is Record<string, JsonLike> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderPrimitive(value: JsonLike) {
  return <span className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{String(value)}</span>;
}

function renderArray(values: JsonLike[]) {
  if (values.length === 0) {
    return <span className="text-sm text-slate-500">暂无内容</span>;
  }

  const simpleValues = values.every((item) => typeof item !== 'object' || item === null);
  if (simpleValues) {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
        {values.map((item, index) => (
          <div
            key={`${String(item)}-${index}`}
            className="flex items-start gap-3 border-b border-slate-200/80 px-4 py-3 last:border-b-0"
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold text-slate-500">
              {index + 1}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
              {String(item)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {values.map((item, index) => (
        <div key={index} className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3">
          {renderStructuredValue(item)}
        </div>
      ))}
    </div>
  );
}

function renderObject(record: Record<string, JsonLike>) {
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return <span className="text-sm text-slate-500">暂无内容</span>;
  }

  return (
    <div className="divide-y divide-slate-200">
      {entries.map(([key, value]) => (
        <section key={key} className="space-y-3 py-4 first:pt-0 last:pb-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{formatOutputLabel(key)}</div>
          <div className="min-w-0 overflow-hidden text-sm leading-6 text-slate-700">{renderStructuredValue(value)}</div>
        </section>
      ))}
    </div>
  );
}

function renderStageOutput(value: unknown) {
  if (value === null || value === undefined) {
    return <span className="text-sm text-slate-500">暂无输出</span>;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span className="text-sm text-slate-500">暂无输出</span>;
    }

    return (
      <div className="space-y-1">
        {entries.map(([key, entryValue]) => (
          <section key={key} className="rounded-xl border border-slate-200/80 bg-slate-50/40 px-4 py-4">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
              {formatOutputLabel(key)}
            </div>
            <div className="min-w-0 overflow-hidden">{renderStructuredValue(entryValue)}</div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200/80 bg-slate-50/40 px-4 py-4">
      {renderStructuredValue(value)}
    </div>
  );
}

function renderStructuredValue(value: unknown): ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-sm text-slate-500">暂无内容</span>;
  }

  if (Array.isArray(value)) {
    return renderArray(value as JsonLike[]);
  }

  if (isRecord(value)) {
    return renderObject(value);
  }

  return renderPrimitive(value as JsonLike);
}

export function StageCard(props: StageCardProps) {
  const shouldShowStatusMessage =
    !!props.statusMessage && (props.status === 'RUNNING' || props.status === 'FAILED');

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="space-y-5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-primary">{props.title}</div>
            <div className="mt-1 text-[28px] font-bold leading-none tracking-tight text-slate-950">
              {props.subtitle}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {props.metaItems?.map((item) => (
              <div key={item.key} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="mb-0.5 text-[11px] font-semibold text-slate-400">{item.label}</div>
                <div className="text-sm font-semibold text-slate-950">{item.value}</div>
              </div>
            ))}
            {props.attempt ? (
              <Badge className="rounded-xl px-3 py-1.5 text-xs font-semibold" variant="outline">
                第 {props.attempt} 次
              </Badge>
            ) : null}
            <Badge
              className="rounded-xl px-3 py-1.5 text-xs font-semibold"
              variant={
                props.status === 'COMPLETED'
                  ? 'success'
                  : props.status === 'FAILED' || props.status === 'REJECTED'
                    ? 'destructive'
                    : props.status === 'WAITING_CONFIRMATION'
                      ? 'warning'
                      : 'default'
              }
            >
              {formatStageStatus(props.status)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-5 pt-0">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-slate-400">阶段产出</div>
        {shouldShowStatusMessage ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
            {props.statusMessage}
          </div>
        ) : null}

        <div className="space-y-3">
          {props.output ? renderStageOutput(props.output) : <span className="text-sm text-slate-500">暂无输出</span>}
        </div>

        <div className="flex flex-wrap gap-3">
          {props.actions && props.actions.length > 0 ? (
            props.actions.map((action) => (
              <Button
                key={action.key}
                variant={action.danger ? 'destructive' : action.variant === 'primary' ? 'default' : 'outline'}
                onClick={action.onClick}
                disabled={action.disabled}
              >
                {action.loading ? '处理中...' : action.label}
              </Button>
            ))
          ) : (
            <span className="text-sm text-slate-500">当前阶段暂无可用操作</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
