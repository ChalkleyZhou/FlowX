import type { DemoArtifact, DesignSpec } from '../common/types';

export function buildDesignMarkdownFromStructured(
  design: DesignSpec,
  demo: DemoArtifact,
): string {
  const pages = (design.pages ?? [])
    .map((page, index) => {
      const title = typeof page.name === 'string' ? page.name : `页面 ${index + 1}`;
      const route = typeof page.route === 'string' ? page.route : '';
      const layout = typeof page.layout === 'string' ? page.layout : '';
      return [`### ${title}`, route ? `- 路由：${route}` : '', layout ? `- 布局：${layout}` : '']
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  const included = demo.scope?.included?.length ? demo.scope.included.join('、') : '（无）';
  const excluded = demo.scope?.excluded?.length ? demo.scope.excluded.join('、') : '（无）';
  const flows =
    (demo.flows ?? [])
      .map((f) => `- ${f.name}：${f.goal}（入口 ${f.entry}）`)
      .join('\n') || '- （无）';
  const gaps = (demo.knownGaps ?? []).map((g) => `- ${g}`).join('\n') || '- （无）';

  return [
    '# 设计文档',
    '',
    '## 概述',
    '',
    design.overview?.trim() || '（无）',
    '',
    '## 页面',
    '',
    pages || '（无）',
    '',
    '## Demo 场景',
    '',
    design.demoScenario?.trim() || '（无）',
    '',
    '## 设计理由',
    '',
    design.designRationale?.trim() || '（无）',
    '',
    '## Demo 摘要',
    '',
    demo.summary?.trim() || '（无）',
    '',
    '## 流程',
    '',
    flows,
    '',
    '## 范围',
    '',
    `- 包含：${included}`,
    `- 排除：${excluded}`,
    '',
    '## 已知缺口',
    '',
    gaps,
    '',
  ].join('\n');
}
