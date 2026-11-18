import { describe, expect, it } from 'vitest';
import { normalizeApplicableEnds, normalizeDeviceModels, normalizeTestCaseProfile } from './test-case-profile';

describe('test case profile', () => {
  it('expands combined applicable ends into a stable multi-select', () => {
    expect(normalizeApplicableEnds('双端')).toEqual(['phone', 'glasses']);
    expect(normalizeApplicableEnds('三端')).toEqual(['phone', 'glasses', 'platform']);
    expect(normalizeApplicableEnds('手机端+眼镜端')).toEqual(['phone', 'glasses']);
    expect(normalizeApplicableEnds(['平台端', 'phone', '后台服务'])).toEqual(['phone', 'platform', 'backend']);
  });

  it('splits combined device models without treating 全部 as every model', () => {
    expect(normalizeDeviceModels('RG301/RG303')).toEqual(['RG301', 'RG303']);
    expect(normalizeDeviceModels('全部')).toEqual(['全部']);
  });

  it('keeps the excel case profile fields and drops blank text', () => {
    expect(normalizeTestCaseProfile({
      scenarioType: ' 权限/鉴权 ',
      caseType: '探索',
      deviceModels: '全部',
      applicableEnds: '双端',
      traceId: ' RTM-COL-AUTH ',
      purpose: ' 验证登录 ',
      passCriteria: ' 跳转登录 ',
      failCriteria: ' 与预期不一致 ',
      automationStatus: '待评估',
      remark: '  ',
    })).toEqual({
      scenarioType: '权限/鉴权',
      caseType: '探索',
      deviceModels: ['全部'],
      applicableEnds: ['phone', 'glasses'],
      traceId: 'RTM-COL-AUTH',
      purpose: '验证登录',
      passCriteria: '跳转登录',
      failCriteria: '与预期不一致',
      automationStatus: '待评估',
      remark: null,
    });
  });
});
