import Papa from 'papaparse';
import type { TestCaseImportRow } from '../types';

const HEADERS = {
  externalId: '用例编号（可选）',
  title: '标题（必填）',
  priority: '优先级（默认P2）',
  moduleName: '模块（可选，需已存在）',
  precondition: '前置条件（可选）',
  steps: '步骤（必填，每行一个）',
  expected: '预期结果（必填）',
  tags: '标签（用英文逗号分隔）',
} as const;

const TEMPLATE_HEADERS = Object.values(HEADERS);
const REQUIRED_HEADERS = [HEADERS.title, HEADERS.steps, HEADERS.expected];
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);

export interface TestCaseImportError {
  row: number;
  message: string;
}

export interface TestCaseImportPreview {
  rows: TestCaseImportRow[];
  errors: TestCaseImportError[];
  sourceRowCount: number;
}

export function buildTestCaseImportTemplate() {
  return `\uFEFF${Papa.unparse({ fields: TEMPLATE_HEADERS, data: [] }, { newline: '\r\n' })}\r\n`;
}

export function downloadTestCaseImportTemplate() {
  const blob = new Blob([buildTestCaseImportTemplate()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'FlowX-测试用例导入模板.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseTestCaseImportCsv(csv: string): TestCaseImportPreview {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
  });
  const errors: TestCaseImportError[] = [];
  const fields = parsed.meta.fields ?? [];

  for (const header of REQUIRED_HEADERS) {
    if (!fields.includes(header)) errors.push({ row: 1, message: `缺少列“${header}”` });
  }
  for (const error of parsed.errors) {
    errors.push({ row: (error.row ?? 0) + 2, message: 'CSV 格式有误，请检查引号和换行' });
  }
  if (parsed.data.length > 1000) {
    errors.push({ row: 1, message: '单次最多导入 1000 条用例' });
  }

  const externalIdRows = new Map<string, number>();
  const rows = parsed.data.slice(0, 1000).map((source, index): TestCaseImportRow => {
    const rowNumber = index + 2;
    const externalId = source[HEADERS.externalId]?.trim();
    const title = source[HEADERS.title]?.trim() ?? '';
    const priorityValue = (source[HEADERS.priority]?.trim().toUpperCase() || 'P2');
    const moduleName = source[HEADERS.moduleName]?.trim();
    const precondition = source[HEADERS.precondition]?.trim();
    const steps = (source[HEADERS.steps] ?? '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    const expected = source[HEADERS.expected]?.trim() ?? '';
    const tags = (source[HEADERS.tags] ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (!title) errors.push({ row: rowNumber, message: '标题不能为空' });
    if (!PRIORITIES.has(priorityValue)) {
      errors.push({ row: rowNumber, message: '优先级只能填写 P0、P1、P2 或 P3' });
    }
    if (!steps.length) errors.push({ row: rowNumber, message: '至少填写一个执行步骤' });
    if (steps.length > 50) errors.push({ row: rowNumber, message: '执行步骤不能超过 50 个' });
    if (!expected) errors.push({ row: rowNumber, message: '预期结果不能为空' });
    if (tags.length > 20) errors.push({ row: rowNumber, message: '标签不能超过 20 个' });
    if (externalId) {
      const previousRow = externalIdRows.get(externalId);
      if (previousRow) {
        errors.push({ row: rowNumber, message: `用例编号与第 ${previousRow} 行重复` });
      } else {
        externalIdRows.set(externalId, rowNumber);
      }
    }

    return {
      externalId: externalId || undefined,
      title,
      priority: PRIORITIES.has(priorityValue)
        ? priorityValue as TestCaseImportRow['priority']
        : undefined,
      moduleName: moduleName || undefined,
      precondition: precondition || undefined,
      steps,
      expected,
      tags: tags.length ? tags : undefined,
    };
  });

  if (!parsed.data.length && !errors.length) {
    errors.push({ row: 1, message: '文件中没有可导入的用例' });
  }

  return { rows, errors, sourceRowCount: parsed.data.length };
}
