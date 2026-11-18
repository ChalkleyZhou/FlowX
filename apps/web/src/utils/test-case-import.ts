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
  scenarioType: '场景类型（可选）',
  caseType: '用例类型（可选）',
  applicableEnds: '适用端（可选，双端=手机端+眼镜端，三端=手机端+眼镜端+平台端）',
  deviceModels: '适用机型（可选，用 / 分隔）',
  traceId: '需求/追溯ID（可选）',
  purpose: '测试目的（可选）',
  passCriteria: '通过标准（可选）',
  failCriteria: '失败判定（可选）',
  automationStatus: '是否可自动化（可选）',
  remark: '备注（可选）',
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
const APPLICABLE_END_ORDER = ['phone', 'glasses', 'platform', 'backend'] as const;
const APPLICABLE_END_GROUPS: Record<string, Array<(typeof APPLICABLE_END_ORDER)[number]>> = {
  phone: ['phone'], glasses: ['glasses'], platform: ['platform'], backend: ['backend'],
  手机端: ['phone'], 眼镜端: ['glasses'], 平台端: ['platform'], 后台服务: ['backend'],
  双端: ['phone', 'glasses'], 三端: ['phone', 'glasses', 'platform'],
};

export function normalizeImportedApplicableEnds(value: string): string[] {
  const selected = new Set<string>();
  for (const token of value.split(/[/+,，、;；]+/).map((item) => item.trim()).filter(Boolean)) {
    for (const end of APPLICABLE_END_GROUPS[token] ?? []) selected.add(end);
  }
  return APPLICABLE_END_ORDER.filter((end) => selected.has(end));
}

function normalizeImportedDeviceModels(value: string): string[] {
  const models: string[] = [];
  for (const token of value.split(/[/+,，、;；]+/).map((item) => item.trim()).filter(Boolean)) {
    if (!models.includes(token)) models.push(token);
  }
  return models;
}

function sheetMatrix(workbook: XLSX.WorkBook, name: string) {
  const sheet = workbook.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: false, blankrows: false });
}

export function parseTestCaseImportXlsx(buffer: ArrayBuffer): TestCaseImportPreview {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const name = workbook.SheetNames[0];
  if (!name) return { rows: [], errors: [{ row: 1, message: '文件中没有工作表' }], sourceRowCount: 0 };
  const matrix = sheetMatrix(workbook, name);
  const fields = (matrix[0] ?? []).map((value) => String(value).trim());
  if (!EXTERNAL_HEADERS.every((header) => fields.includes(header)) && !REQUIRED_HEADERS.every((header) => fields.includes(header))) {
    return { rows: [], errors: [{ row: 1, message: '只读取第一个工作表，当前表头不符合 FlowX 模板或标准用例表' }], sourceRowCount: 0 };
  }
  if (EXTERNAL_HEADERS.every((header) => fields.includes(header))) {
    const index = (header: string) => fields.indexOf(header);
    const value = (row: string[], header: string) => index(header) < 0 ? '' : String(row[index(header)] ?? '').trim();
    const data = matrix.slice(1).map((row) => ({
      [HEADERS.externalId]: value(row, '用例ID'),
      [HEADERS.title]: value(row, '用例标题'),
      [HEADERS.priority]: value(row, '优先级'),
      [HEADERS.moduleName]: value(row, '二级模块'),
      [HEADERS.parentModuleName]: value(row, '一级模块'),
      [HEADERS.precondition]: value(row, '前置条件'),
      [HEADERS.testData]: value(row, '测试数据'),
      [HEADERS.steps]: value(row, '操作步骤'),
      [HEADERS.expected]: value(row, '预期结果'),
      [HEADERS.tags]: '',
      [HEADERS.scenarioType]: value(row, '场景类型'),
      [HEADERS.caseType]: value(row, '用例类型'),
      [HEADERS.applicableEnds]: value(row, '适用端'),
      [HEADERS.deviceModels]: value(row, '适用机型'),
      [HEADERS.traceId]: value(row, '需求/追溯ID'),
      [HEADERS.purpose]: value(row, '测试目的'),
      [HEADERS.passCriteria]: value(row, '通过标准'),
      [HEADERS.failCriteria]: value(row, '失败判定'),
      [HEADERS.automationStatus]: value(row, '是否可自动化'),
      [HEADERS.remark]: value(row, '备注'),
    }));
    return {
      ...parseTestCaseImportCsv(Papa.unparse({ fields: TEMPLATE_HEADERS, data })),
      notice: '已读取标准用例表。二级模块会按一级模块自动创建或复用。适用端按多选保存：双端为手机端和眼镜端，三端再加平台端。执行结果、实际结果、缺陷 ID 和执行版本属于某次执行，不写入用例定义。',
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
    const scenarioType = source[HEADERS.scenarioType]?.trim();
    const caseType = source[HEADERS.caseType]?.trim();
    const applicableEnds = normalizeImportedApplicableEnds(source[HEADERS.applicableEnds] ?? '');
    const deviceModels = normalizeImportedDeviceModels(source[HEADERS.deviceModels] ?? '');
    const traceId = source[HEADERS.traceId]?.trim();
    const purpose = source[HEADERS.purpose]?.trim();
    const passCriteria = source[HEADERS.passCriteria]?.trim();
    const failCriteria = source[HEADERS.failCriteria]?.trim();
    const automationStatus = source[HEADERS.automationStatus]?.trim();
    const remark = source[HEADERS.remark]?.trim();

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
      ...(scenarioType ? { scenarioType } : {}),
      ...(caseType ? { caseType } : {}),
      ...(applicableEnds.length ? { applicableEnds } : {}),
      ...(deviceModels.length ? { deviceModels } : {}),
      ...(traceId ? { traceId } : {}),
      ...(purpose ? { purpose } : {}),
      ...(passCriteria ? { passCriteria } : {}),
      ...(failCriteria ? { failCriteria } : {}),
      ...(automationStatus ? { automationStatus } : {}),
      ...(remark ? { remark } : {}),
    };
  });

  if (!parsed.data.length && !errors.length) {
    errors.push({ row: 1, message: '文件中没有可导入的用例' });
  }

  return { rows, errors, sourceRowCount: parsed.data.length };
}
