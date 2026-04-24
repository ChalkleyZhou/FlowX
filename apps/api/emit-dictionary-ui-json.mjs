import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const componentPath = path.join(__dirname, '.flowx-demo-dictionary-page.tsx');
let componentCode = fs.readFileSync(componentPath, 'utf8');
componentCode = componentCode.replaceAll(
  "from '../../components/",
  "from '../../components/",
);
// File lives under apps/api for generation; demo page path is apps/web/src/pages/flowx-demo/
componentCode = componentCode.replaceAll("from '../../components/", "from '../../components/");

const mockData = {
  categories: [
    {
      id: 'cat-source',
      name: '来源渠道',
      code: 'lead_source',
      status: '启用',
      description: '线索与客户来源的标准分类，用于报表对齐口径。',
    },
    {
      id: 'cat-priority',
      name: '处理优先级',
      code: 'ticket_priority',
      status: '启用',
      description: '工单与缺陷的优先级枚举，供列表筛选与 SLA 规则引用。',
    },
  ],
  items: [
    {
      id: 'item-wechat',
      categoryId: 'cat-source',
      label: '企业微信',
      value: 'wecom',
      code: 'SRC_WECOM',
      sort: 10,
      status: '启用',
      remark: '销售侧主要获客渠道。',
    },
    {
      id: 'item-portal',
      categoryId: 'cat-source',
      label: '官网表单',
      value: 'portal',
      code: 'SRC_PORTAL',
      sort: 20,
      status: '启用',
      remark: '',
    },
    {
      id: 'item-legacy',
      categoryId: 'cat-source',
      label: '历史导入',
      value: 'legacy',
      code: 'SRC_LEGACY',
      sort: 30,
      status: '停用',
      remark: '历史数据保留展示；新业务不应再选择。',
    },
    {
      id: 'item-p0',
      categoryId: 'cat-priority',
      label: '紧急',
      value: 'p0',
      code: 'PRIO_P0',
      sort: 10,
      status: '启用',
      remark: '需要 2 小时内响应。',
    },
    {
      id: 'item-p1',
      categoryId: 'cat-priority',
      label: '高',
      value: 'p1',
      code: 'PRIO_P1',
      sort: 20,
      status: '启用',
      remark: '',
    },
  ],
  canManage: true,
};

const doc = {
  overview:
    '采用与 FlowX Web 现有后台列表一致的信息架构：顶部 PageHeader 与指标卡建立场景心智，主体为「字典分类 × 字典项」的左右分栏主从布局；搜索与状态筛选复用 ListToolbar + Input + Select；分类与字典项的创建/编辑使用 Dialog 模态表单；列表行使用 RecordListItem + Badge 呈现编码、取值、启停与排序；空状态统一 EmptyState；风险操作用浏览器确认与 Toast 错误文案承载。该结构便于运营在 3 秒内定位目标字典，同时把重复命名、子项未清空删除、停用项语义等边界做成可见的交互反馈。',
  pages: [
    {
      name: '字典管理（分类与项）',
      route: '/settings/dictionaries',
      layout:
        '[应用壳：左侧导航栏][主内容区] 主内容自上而下为：[PageHeader 标题区： eyebrow + 标题 + 说明 + 右侧主操作「新建字典分类」]；[MetricCard 四列栅格：字典分类数、字典项总数、启用项、停用项]；[Alert 审阅提示条：强调编码变更与生产策略差异]；[两列栅格：左列 Card「字典分类」含 SectionHeader、ListToolbar（搜索 Input + 状态 Select）、ScrollArea 内可点击分类卡片列表（名称/编码/状态 Badge/说明摘要/子项数量，选中高亮）；右列 Card「字典项」含 SectionHeader（随选中分类变化标题，右侧「新建字典项」）、字典项 RecordListItem 列表（编码/取值/状态/排序 Badge + 备注 + 行内「编辑」「删除」）、底部次要操作「删除当前分类（演示）」]；[Dialog：新建字典分类表单]；[Dialog：新建/编辑字典项表单]。',
      keyComponents: [
        'AppLayout（侧栏+主内容宽度约束）',
        'PageHeader',
        'MetricCard',
        'Alert',
        'Card / SectionHeader',
        'ListToolbar / FilterBar',
        'Input / Select / Textarea',
        'ScrollArea',
        'RecordListItem',
        'Badge',
        'Button',
        'Dialog',
        'EmptyState',
        'useToast',
      ],
      interactions:
        '点击左侧分类卡片：右侧标题与字典项列表联动刷新。搜索与状态筛选：同时作用于分类列表与当前分类下的字典项列表。新建分类：打开 Dialog，保存时若名称或编码重复则 Toast 错误并留在表单。新建/编辑字典项：打开 Dialog；保存时同分类内编码或取值重复则拦截。删除字典项：确认对话框后移除（演示）。删除分类：若仍有字典项则 Toast 错误禁止删除；若无子项则二次确认后删除并自动选中剩余第一个分类。停用项在列表中以 warning Badge 标示；文案提示历史展示与新业务选择边界。',
    },
    {
      name: '字典详情（可选独立路由）',
      route: '/settings/dictionaries/:categoryId',
      layout:
        '[应用壳] 主内容：[PageHeader 返回/面包屑占位 + 当前分类名称]；[两列或单列：左/上为分类关键信息摘要 Card（编码、状态、说明）]；[下为字典项列表区：与主页面右侧相同的 ListToolbar + RecordListItem 列表]。用于深链分享或在移动端将主从布局拆页。',
      keyComponents: ['PageHeader', 'Card', 'SectionHeader', 'ListToolbar', 'RecordListItem', 'Badge', 'Button', 'Dialog', 'EmptyState'],
      interactions:
        '从列表页跳转时携带 categoryId；加载失败或空分类时 EmptyState 提示而非白屏；编辑/删除交互与列表页一致。',
    },
  ],
  demoScenario: [
    '管理员登录后台，打开「字典管理」演示路由，看到指标卡与审阅提示。',
    '在左侧选中「来源渠道」，右侧展示企业微信、官网表单、历史导入等字典项；注意到「历史导入」为停用状态。',
    '在 ListToolbar 搜索框输入「官网」，左右列表同步过滤，确认能在几秒内定位目标项。',
    '点击「新建字典项」，填写显示名称与取值，故意输入重复取值，点击保存，看到错误 Toast 与表单保留。',
    '修正为唯一取值后保存成功，列表即时出现新项。',
    '点击「删除当前分类」尝试删除仍有子项的分类，看到阻止删除的 Toast。',
    '切换到「处理优先级」，删除全部字典项后（演示），再删除分类，确认二次确认后分类被移除。',
    '将筛选切换为「停用」，确认仅显示停用分类或停用项；若结果为空，看到 EmptyState 说明而非加载失败。',
  ],
  designRationale:
    '沿用需求列表等页面的 Card + SectionHeader + ListToolbar + RecordListItem 模式，可在不引入新视觉语言的前提下让字典管理「看起来像 FlowX 原生后台」。左右主从结构直接映射「字典分类 / 字典项」两级业务心智，减少跨页跳转；MetricCard 与 Alert 满足负责人审阅与运营快速扫视。把简报中的高风险点（重复、误删、停用语义）前移到保存与删除的即时反馈，符合「可审阅、可控、易用」目标。',
  demoPages: [
    {
      route: '/flowx-demo/dictionaries',
      componentName: 'FlowxDemoDictionaryAdminPage',
      componentCode,
      mockData,
      filePath: 'apps/web/src/pages/flowx-demo/FlowxDemoDictionaryAdminPage.tsx',
    },
  ],
};

process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
