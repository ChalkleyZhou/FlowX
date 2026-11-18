export const APPLICABLE_ENDS = ['phone', 'glasses', 'platform', 'backend'] as const;

export type ApplicableEnd = (typeof APPLICABLE_ENDS)[number];

export interface TestCaseProfile {
  scenarioType: string | null;
  caseType: string | null;
  deviceModels: string[];
  applicableEnds: ApplicableEnd[];
  traceId: string | null;
  purpose: string | null;
  passCriteria: string | null;
  failCriteria: string | null;
  automationStatus: string | null;
  remark: string | null;
}

const END_GROUPS: Record<string, ApplicableEnd[]> = {
  phone: ['phone'],
  glasses: ['glasses'],
  platform: ['platform'],
  backend: ['backend'],
  手机端: ['phone'],
  眼镜端: ['glasses'],
  平台端: ['platform'],
  后台服务: ['backend'],
  双端: ['phone', 'glasses'],
  三端: ['phone', 'glasses', 'platform'],
};

const AUTOMATION_STATUS: Record<string, string> = {
  是: '是',
  否: '否',
  部分: '部分',
  待评估: '待评估',
  YES: '是',
  NO: '否',
  PARTIAL: '部分',
  PENDING: '待评估',
};

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function tokens(value: unknown): string[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return source.flatMap((item) => String(item).split(/[/+,，、;；]+/)).map((item) => item.trim()).filter(Boolean);
}

export function normalizeApplicableEnds(value: unknown): ApplicableEnd[] {
  const selected = new Set<ApplicableEnd>();
  for (const token of tokens(value)) {
    for (const end of END_GROUPS[token] ?? []) selected.add(end);
  }
  return APPLICABLE_ENDS.filter((end) => selected.has(end));
}

export function normalizeDeviceModels(value: unknown): string[] {
  const models: string[] = [];
  for (const token of tokens(value)) {
    if (!models.includes(token)) models.push(token.slice(0, 100));
    if (models.length >= 20) break;
  }
  return models;
}

export function normalizeTestCaseProfile(input: {
  scenarioType?: unknown;
  caseType?: unknown;
  deviceModels?: unknown;
  applicableEnds?: unknown;
  traceId?: unknown;
  purpose?: unknown;
  passCriteria?: unknown;
  failCriteria?: unknown;
  automationStatus?: unknown;
  remark?: unknown;
} | null | undefined): TestCaseProfile {
  const source = input ?? {};
  const automation = typeof source.automationStatus === 'string' ? source.automationStatus.trim() : '';
  return {
    scenarioType: text(source.scenarioType, 50),
    caseType: text(source.caseType, 50),
    deviceModels: normalizeDeviceModels(source.deviceModels),
    applicableEnds: normalizeApplicableEnds(source.applicableEnds),
    traceId: text(source.traceId, 200),
    purpose: text(source.purpose, 5000),
    passCriteria: text(source.passCriteria, 5000),
    failCriteria: text(source.failCriteria, 5000),
    automationStatus: automation ? AUTOMATION_STATUS[automation] ?? automation.slice(0, 20) : null,
    remark: text(source.remark, 5000),
  };
}

export function profileFromRecord(value: unknown): TestCaseProfile {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return normalizeTestCaseProfile(record);
}

const PROFILE_KEYS = [
  'scenarioType', 'caseType', 'deviceModels', 'applicableEnds', 'traceId',
  'purpose', 'passCriteria', 'failCriteria', 'automationStatus', 'remark',
] as const;

export function profilePatch(input: object): Partial<TestCaseProfile> {
  const source = input as Record<string, unknown>;
  const normalized = normalizeTestCaseProfile(source);
  const patch: Partial<TestCaseProfile> = {};
  for (const key of PROFILE_KEYS) {
    if (source[key] !== undefined) patch[key] = normalized[key] as never;
  }
  return patch;
}
