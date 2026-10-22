export const analysis = {
  title: '事项看板', description: '管理事项并跟踪进度', acceptanceCriteria: ['可以创建事项'],
  brief: { expandedDescription: '事项管理', userStories: [{ role: '成员', action: '创建事项', benefit: '跟踪进度' }], edgeCases: [], successMetrics: [], openQuestions: [], assumptions: [], outOfScope: [] },
  design: { overview: '保留上传看板', pages: [{ name: '看板', route: 'index.html', layout: '列表', keyComponents: ['新增按钮'], interactions: ['点击新增'] }], demoScenario: '创建事项', designRationale: '依据原型' },
  clarifications: [{ id: 'permission', question: '谁可以删除事项？', required: true, suggestedAnswer: '仅创建人' }],
  evidence: [{ path: 'index.html', observation: '包含新增按钮' }], inferences: ['删除权限未在原型中表达'],
};
