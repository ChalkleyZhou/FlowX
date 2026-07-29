import type { ReactNode } from 'react';
import type { SpecPlanOutput } from '../types';

interface SpecPlanDocumentPanelProps {
  output: SpecPlanOutput;
}

function renderStringList(items: string[]) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无内容</p>;
  }
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-foreground">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function renderSection(title: string, children: ReactNode) {
  return (
    <section className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</div>
      {children}
    </section>
  );
}

export function SpecPlanDocumentPanel({ output }: SpecPlanDocumentPanelProps) {
  return (
    <div className="space-y-5">
      {renderSection(
        'Spec · 目标',
        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{output.spec.goal}</p>,
      )}
      {renderSection('Spec · 范围', renderStringList(output.spec.scope))}
      {renderSection('Spec · 非目标', renderStringList(output.spec.nonGoals))}
      {renderSection('Spec · 验收标准', renderStringList(output.spec.acceptanceCriteria))}
      {renderSection('Spec · 约束', renderStringList(output.spec.constraints))}
      {renderSection(
        'Plan · 方案',
        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{output.plan.approach}</p>,
      )}
      {renderSection('Plan · 改动触点', renderStringList(output.plan.touchpoints))}
      {renderSection('Plan · 实施顺序', renderStringList(output.plan.sequence))}
      {renderSection('Plan · 风险', renderStringList(output.plan.risks))}
      {renderSection('Plan · 验证', renderStringList(output.plan.verification))}
      {output.notes?.checklist?.length ? renderSection('Notes · 检查项', renderStringList(output.notes.checklist)) : null}
      {output.notes?.openQuestions?.length
        ? renderSection('Notes · 待澄清', renderStringList(output.notes.openQuestions))
        : null}
    </div>
  );
}
