import { describe, expect, it } from 'vitest';
import { buildDesignMarkdownFromStructured } from './design-markdown';

describe('buildDesignMarkdownFromStructured', () => {
  it('builds a readable markdown document from design and demo', () => {
    const md = buildDesignMarkdownFromStructured(
      {
        overview: '导出页改版',
        pages: [{ name: '首页', route: '/', layout: '单列', keyComponents: ['按钮'], interactions: ['点击导出'] }],
        demoScenario: '用户导出报表',
        designRationale: '降低认知负担',
      },
      {
        summary: '主流程可走通',
        flows: [{ name: '导出', goal: '完成导出', entry: '/', states: ['空态', '成功'] }],
        scope: { included: ['Web'], excluded: ['移动端'] },
        knownGaps: ['无暗色'],
      },
    );
    expect(md).toContain('# 设计文档');
    expect(md).toContain('导出页改版');
    expect(md).toContain('用户导出报表');
    expect(md).toContain('主流程可走通');
    expect(md).toContain('导出');
  });
});
