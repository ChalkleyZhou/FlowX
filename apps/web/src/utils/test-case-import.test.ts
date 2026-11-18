import { describe, expect, it } from 'vitest';
import { buildTestCaseImportTemplate, parseTestCaseImportCsv, parseTestCaseImportXlsx } from './test-case-import';
import * as XLSX from 'xlsx';

describe('test case CSV import', () => {
  it('builds a UTF-8 template with the supported columns', () => {
    const template = buildTestCaseImportTemplate();

    expect(template.startsWith('\uFEFF')).toBe(true);
    expect(template).toContain('标题（必填）');
    expect(template).toContain('步骤（必填，每行一个）');
    expect(template).toContain('预期结果（必填）');
    expect(template).toContain('测试数据（可选）');
  });

  it('maps the external Excel case format and retains extra classification as tags', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['用例ID', '用例标题', '一级模块', '二级模块', '场景类型', '优先级', '用例类型', '适用端', '适用机型', '需求/追溯ID', '测试目的', '前置条件', '测试数据', '操作步骤', '预期结果'],
      ['CASE-1', '登录', '账号', '登录', '正常', 'P0', '功能测试', '手机端', '全部', 'REQ-1', '验证登录', '已注册', '账号=test', '输入账号', '进入首页'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, '用例');
    const preview = parseTestCaseImportXlsx(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]).toMatchObject({
      externalId: 'CASE-1',
      parentModuleName: '账号',
      moduleName: '登录',
      testData: '账号=test',
      steps: ['输入账号'],
      scenarioType: '正常',
      caseType: '功能测试',
      applicableEnds: ['phone'],
      deviceModels: ['全部'],
      traceId: 'REQ-1',
      purpose: '验证登录',
    });
    expect(preview.rows[0].tags).toBeUndefined();
    expect(preview.autoCreateModules).toBe(true);
    expect(preview.notice).toContain('双端为手机端和眼镜端');
  });

  it('expands combined ends on the first sheet and ignores later sheets', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['用例ID', '用例标题', '一级模块', '二级模块', '场景类型', '优先级', '用例类型', '适用端', '适用机型', '需求/追溯ID', '测试目的', '前置条件', '测试数据', '操作步骤', '预期结果', '通过标准', '失败判定', '是否可自动化', '备注'],
      ['CASE-2', '双端登录', '账号', '登录', '主流程', 'P0', '黑盒', '双端', 'RG301/RG303', 'RTM-1', '验证双端', '已注册', '', '输入账号', '进入首页', '两端都进入首页', '任一端失败', '部分', '联调'],
      ['CASE-3', '三端登录', '账号', '登录', '主流程', 'P1', '黑盒', '三端', '全部', 'RTM-1', '验证三端', '已注册', '', '输入账号', '进入首页', '', '', '待评估', ''],
    ]), 'testcase items');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['用例ID', '用例标题', '优先级', '操作步骤', '预期结果'], ['IGNORED', '忽略', 'P0', '不要读', '不要读']]), '其他');
    const preview = parseTestCaseImportXlsx(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
    expect(preview.errors).toEqual([]);
    expect(preview.rows.map((row) => row.externalId)).toEqual(['CASE-2', 'CASE-3']);
    expect(preview.rows.map((row) => row.applicableEnds)).toEqual([['phone', 'glasses'], ['phone', 'glasses', 'platform']]);
    expect(preview.rows[0]).toMatchObject({ deviceModels: ['RG301', 'RG303'], passCriteria: '两端都进入首页', failCriteria: '任一端失败', automationStatus: '部分', remark: '联调' });
  });

  it('rejects a nonstandard first sheet without reading later sheets', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['项', '值'], ['主 Sheet', 'testcase items']]), '说明');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['用例ID', '用例标题', '优先级', '操作步骤', '预期结果'],
      ['CASE-9', '不应导入', 'P0', '执行', '成功'],
    ]), 'testcase items');
    const preview = parseTestCaseImportXlsx(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
    expect(preview.rows).toEqual([]);
    expect(preview.errors).toEqual([{ row: 1, message: '只读取第一个工作表，当前表头不符合 FlowX 模板或标准用例表' }]);
  });

  it('parses multiline steps, defaults priority and splits tags', () => {
    const csv = [
      '用例编号（可选）,标题（必填）,优先级（默认P2）,模块（可选，需已存在）,前置条件（可选）,步骤（必填，每行一个）,预期结果（必填）,标签（用英文逗号分隔）',
      'LOGIN-001,账号密码登录,,登录,已注册账号,"输入账号\n点击登录",进入首页,"冒烟,核心"',
    ].join('\n');

    expect(parseTestCaseImportCsv(csv)).toEqual({
      sourceRowCount: 1,
      errors: [],
      rows: [{
        externalId: 'LOGIN-001',
        title: '账号密码登录',
        priority: 'P2',
        moduleName: '登录',
        precondition: '已注册账号',
        steps: ['输入账号', '点击登录'],
        expected: '进入首页',
        tags: ['冒烟', '核心'],
      }],
    });
  });

  it('reports missing columns, invalid rows and duplicate IDs', () => {
    const csv = [
      '用例编号（可选）,标题（必填）,优先级（默认P2）,步骤（必填，每行一个）',
      'CASE-1,,P9,',
      'CASE-1,重复编号,P1,执行',
    ].join('\n');
    const preview = parseTestCaseImportCsv(csv);

    expect(preview.errors).toEqual(expect.arrayContaining([
      { row: 1, message: '缺少列“预期结果（必填）”' },
      { row: 2, message: '标题不能为空' },
      { row: 2, message: '优先级只能填写 P0、P1、P2 或 P3' },
      { row: 2, message: '至少填写一个执行步骤' },
      { row: 3, message: '用例编号与第 2 行重复' },
    ]));
  });
});
