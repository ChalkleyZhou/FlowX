import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { TestCaseImportRow } from '../types';

const HEADERS = {
  externalId: '用例编号（可选）',
  title: '标题（必填）',
  priority: '优先级（默认P2）',
  moduleName: '模块（可选，需已存在）',
  parentModuleName: '父级模块（可选）',
  precondition: '前置条件（可选）',
  testData: '测试数据（可选）',
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
  notice?: string;
  autoCreateModules?: boolean;
}

const EXTERNAL_HEADERS = ['用例ID', '用例标题', '优先级', '操作步骤', '预期结果'];

export function parseTestCaseImportXlsx(buffer: ArrayBuffer): TestCaseImportPreview {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { rows: [], errors: [{ row: 1, message: '文件中没有工作表' }], sourceRowCount: 0 };
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: false, blankrows: false });
  const fields = (matrix[0] ?? []).map((value) => String(value).trim());
  if (EXTERNAL_HEADERS.every((header) => fields.includes(header))) {
    const index = (header: string) => fields.indexOf(header);
    const value = (row: string[], header: string) => String(row[index(header)] ?? '').trim();
    const data = matrix.slice(1).map((row) => {
      const tags = ['一级模块', '二级模块', '场景类型', '用例类型', '适用端', '适用机型', '需求/追溯ID']
        .map((header) => {
          const content = value(row, header);
          return content ? `${header}=${content.replaceAll(',', '，')}` : '';
        })
        .filter(Boolean);
      return {
        [HEADERS.externalId]: value(row, '用例ID'),
        [HEADERS.title]: value(row, '用例标题'),
        [HEADERS.priority]: value(row, '优先级'),
        [HEADERS.moduleName]: value(row, '二级模块'),
        [HEADERS.parentModuleName]: value(row, '一级模块'),
        [HEADERS.precondition]: value(row, '前置条件'),
        [HEADERS.testData]: value(row, '测试数据'),
        [HEADERS.steps]: value(row, '操作步骤'),
        [HEADERS.expected]: value(row, '预期结果'),
        [HEADERS.tags]: tags.join(','),
      };
    });
    return {
      ...parseTestCaseImportCsv(Papa.unparse({ fields: TEMPLATE_HEADERS, data })),
      notice: '二级模块会按一级模块自动创建或复用，导入前无需手工建模块。一级模块、场景、用例类型、适用范围和追溯 ID 已保留为标签；测试目的、通过标准、失败判定、自动化状态、备注及执行记录列不导入。',
      autoCreateModules: true,
    };
  }
  return parseTestCaseImportCsv(Papa.unparse(matrix));
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
    const parentModuleName = source[HEADERS.parentModuleName]?.trim();
    const precondition = source[HEADERS.precondition]?.trim();
    const testData = source[HEADERS.testData]?.trim();
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
    if (testData && testData.length > 5000) errors.push({ row: rowNumber, message: '测试数据不能超过 5000 字' });
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
      parentModuleName: parentModuleName || undefined,
      precondition: precondition || undefined,
      ...(testData ? { testData } : {}),
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
