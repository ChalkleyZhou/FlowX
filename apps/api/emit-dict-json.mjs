import fs from 'fs';
const code = fs.readFileSync('dictionary-module-demo-tsx.txt', 'utf8');
const mock = {
  readOnly: false,
  summary: { categoryCount: 3, itemCount: 7, activeItemCount: 6 },
  categories: [
    { id: 'cat-ops-status', name: '需求状态', code: 'REQ_STATUS', description: '全平台统一的需求状态选项。', status: 'active', itemCount: 3 },
    { id: 'cat-channel', name: '来源渠道', code: 'CHANNEL', description: '市场线索来源分类。', status: 'active', itemCount: 3 },
    { id: 'cat-legacy', name: '历史标签', code: 'LEGACY_TAG', description: '已逐步下线。', status: 'inactive', itemCount: 1 }
  ],
  items: [
    { id: 'i1', categoryId: 'cat-ops-status', label: '待评审', value: 'pending_review', sortOrder: 10, status: 'active', remark: '' },
    { id: 'i2', categoryId: 'cat-ops-status', label: '进行中', value: 'in_progress', sortOrder: 20, status: 'active', remark: '' },
    { id: 'i3', categoryId: 'cat-ops-status', label: '已结项', value: 'closed', sortOrder: 30, status: 'inactive', remark: '停用后新建不可选' },
    { id: 'i4', categoryId: 'cat-channel', label: '自然流量', value: 'organic', sortOrder: 10, status: 'active', remark: '' },
    { id: 'i5', categoryId: 'cat-channel', label: '渠道合作', value: 'partner', sortOrder: 20, status: 'active', remark: '' },
    { id: 'i6', categoryId: 'cat-channel', label: '线下活动', value: 'event', sortOrder: 30, status: 'active', remark: '' },
    { id: 'i7', categoryId: 'cat-legacy', label: '老编码-A', value: 'legacy_a', sortOrder: 1, status: 'active', remark: '历史' }
  ]
};
const out = {
  overview: '以「主内容区三列信息指标 + 双栏主从表」与 FlowX 现有后台页一致，集中维护字典分类与字典项。左侧栏字典分类、右侧当前分类下字典项，弹窗完成新建与编辑，危险操作以对话框与说明承载边界（重复编码/有子级不可删/改编码影响）。',
  pages: [
    {
      name: '字典管理首页',
      route: '/admin/dictionary',
      layout: '[已有 FlowX 侧栏：工作区/项目/需求/…/设置] [主内容区顶：PageHeader 标题+说明+权限徽标] [主内容上：MetricCard 三列] [主内容下：两栏栅格；左卡「字典分类」SectionHeader+ListToolbar(搜索框)+RecordListItem 列表+行内主按钮；右卡「字典项」同结构+顶栏 Alert+Separator] [页脚无固定操作条；操作在卡头与行内、弹窗中]',
      keyComponents: ['PageHeader', 'MetricCard', 'Card', 'SectionHeader', 'ListToolbar', 'Input', 'RecordListItem', 'Badge', 'Button', 'EmptyState', 'Alert', 'Dialog', 'Textarea', 'Select', 'useToast', 'Separator'],
      interactions: '搜索分类实时过滤；点「查看项」高亮主分类并刷新右侧；新建/编辑分类打开 Dialog，保存前校验编码唯一，编辑时展示改编码风险 Alert；分类删除有子项时禁用确认并显示 destructive Alert；项侧同理校验 value 唯一，启停与排序在表单中维护；无结果与无项用 EmptyState，错误用 Toast。'
    }
  ],
  demoScenario: '1) 进入页面阅读指标与两栏。2) 在左栏搜索「渠道」只保留相关分类。3) 点「需求状态」行「查看项」切换右侧。4) 在右栏搜索字典项。5) 点「新项」补一条，保存。6) 在左栏「新建」分类输入重复编码，保存观察 Toast。7) 尝试删除有子项的分类，确认二次对话框状态。8) 删一项并观察左侧计数变化。',
  designRationale: '与现有「需求/问题项」等列表+工具条+RecordListItem 管理页同一语汇，学习成本低；主从分栏在桌面宽屏下一屏完成查与改，避免深层路由；用 Alert 和 destructive 变体把简报中的误删、重复、编码影响讲清楚而不引入审批流。演示路由独立前缀，避免污染业务导航。',
  demoPages: [
    {
      route: '/flowx-demo/dictionary-module',
      componentName: 'DictionaryModuleDemoPage',
      componentCode: code,
      mockData: mock,
      filePath: 'apps/web/src/pages/flowx-demo/DictionaryModuleDemoPage.tsx'
    }
  ]
};
fs.writeFileSync('dictionary-ui-spec.json', JSON.stringify(out, null, 0), 'utf8');
