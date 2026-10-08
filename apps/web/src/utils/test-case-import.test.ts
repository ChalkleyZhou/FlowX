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
    expect(preview.rows[0]).toMatchObject({ externalId: 'CASE-1', parentModuleName: '账号', moduleName: '登录', testData: '账号=test', steps: ['输入账号'] });
    expect(preview.autoCreateModules).toBe(true);
    expect(preview.rows[0].tags).toEqual(expect.arrayContaining(['一级模块=账号', '二级模块=登录', '需求/追溯ID=REQ-1']));
    expect(preview.notice).toContain('执行记录列不导入');
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
