import type { SpecPlanNotes, SpecPlanOutput, SpecPlanPlan, SpecPlanSpec } from '../types';

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function parseSpecPlanSpec(value: unknown): SpecPlanSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.goal !== 'string') {
    return null;
  }
  return {
    goal: record.goal,
    scope: asStringArray(record.scope),
    nonGoals: asStringArray(record.nonGoals),
    acceptanceCriteria: asStringArray(record.acceptanceCriteria),
    constraints: asStringArray(record.constraints),
  };
}

function parseSpecPlanPlan(value: unknown): SpecPlanPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.approach !== 'string') {
    return null;
  }
  return {
    approach: record.approach,
    touchpoints: asStringArray(record.touchpoints),
    sequence: asStringArray(record.sequence),
    risks: asStringArray(record.risks),
    verification: asStringArray(record.verification),
  };
}

function parseSpecPlanNotes(value: unknown): SpecPlanNotes | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const hasChecklist = Array.isArray(record.checklist);
  const hasOpenQuestions = Array.isArray(record.openQuestions);
  if (!hasChecklist && !hasOpenQuestions) {
    return undefined;
  }
  return {
    checklist: hasChecklist ? asStringArray(record.checklist) : undefined,
    openQuestions: hasOpenQuestions ? asStringArray(record.openQuestions) : undefined,
  };
}

export function parseSpecPlanOutput(output: unknown): SpecPlanOutput | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null;
  }
  const record = output as Record<string, unknown>;
  const spec = parseSpecPlanSpec(record.spec);
  const plan = parseSpecPlanPlan(record.plan);
  if (!spec || !plan) {
    return null;
  }
  return {
    spec,
    plan,
    notes: parseSpecPlanNotes(record.notes),
  };
}

export function serializeSpecPlanOutput(output: SpecPlanOutput): string {
  return JSON.stringify(output, null, 2);
}
