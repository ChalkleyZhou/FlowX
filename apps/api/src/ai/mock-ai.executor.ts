import { Injectable } from '@nestjs/common';
import {
  BrainstormInput,
  BrainstormOutput,
  ExecuteTaskInput,
  ExecuteTaskOutput,
  GenerateDesignInput,
  GenerateDesignOptions,
  GenerateDesignOutput,
  GeneratePlanInput,
  GeneratePlanOutput,
  RepositoryComponentContext,
  RepositoryContext,
  ReviewCodeInput,
  ReviewCodeOutput,
  SplitTaskItem,
  SplitTasksInput,
  SplitTasksOutput,
} from '../common/types';
import { AIExecutor, type AIInvocationContext } from './ai-executor';
import { CodexAiExecutor } from './codex-ai.executor';

function createBaselineTasks(title: string): SplitTaskItem[] {
  return [
    {
      title: `Clarify requirement intake experience for ${title}`,
      description: 'Define what information users need to submit, review, and confirm so the requirement can enter the workflow clearly.',
      surface: 'web',
      repositoryNames: ['flowx-web'],
    },
    {
      title: `Define the staged collaboration flow for ${title}`,
      description: 'Describe how users move from task split to technical plan, execution, and review with clear confirmation checkpoints.',
      surface: 'api',
      repositoryNames: ['flowx-api'],
    },
    {
      title: `Provide workflow visibility and confirmation for ${title}`,
      description: 'Ensure operators can inspect stage outputs, understand progress, and make confirmation decisions at each key step.',
      surface: 'web',
      repositoryNames: ['flowx-web'],
    },
  ];
}

@Injectable()
export class MockAiExecutor implements AIExecutor {
  /**
   * Reuse Codex 的磁盘扫描逻辑，使 Mock 在工作流 Demo 阶段也能获得真实组件上下文（与「必须有 grounded 仓库」一致）。
   */
  async buildRepositoryComponentContext(
    repository: RepositoryContext,
  ): Promise<RepositoryComponentContext | null> {
    const scanner = new CodexAiExecutor();
    return (
      scanner as unknown as {
        buildRepositoryComponentContext: (r: RepositoryContext) => Promise<RepositoryComponentContext | null>;
      }
    ).buildRepositoryComponentContext(repository);
  }

  async brainstorm(input: BrainstormInput, _context?: AIInvocationContext): Promise<BrainstormOutput> {
    return {
      brief: {
        expandedDescription: `针对"${input.requirementTitle}"的详细产品描述：\n\n该功能旨在让用户能够高效地完成核心操作流程。通过直观的界面设计和合理的交互逻辑，用户可以快速上手并持续使用。\n\n在业务层面，该功能将提升团队协作效率，减少手动操作带来的错误，并通过数据可视化提供决策支持。\n\n用户体验上，重点在于操作的简洁性和反馈的及时性，确保每一步操作都有明确的结果和引导。`,
        userStories: [
          { role: '普通用户', action: '可以执行核心操作并查看结果', benefit: '快速完成日常任务，提升工作效率' },
          { role: '管理员', action: '可以配置功能参数和管理权限', benefit: '灵活控制系统行为，保障数据安全' },
          { role: '访客', action: '可以浏览公开内容但无法修改', benefit: '了解产品价值，促成转化' },
        ],
        edgeCases: [
          '数据为空时的空状态展示',
          '并发操作导致的数据冲突',
          '大数量数据下的性能表现',
        ],
        successMetrics: [
          '任务完成率 > 80%',
          '平均操作耗时 < 30 秒',
          '用户满意度评分 > 4/5',
        ],
        openQuestions: [
          '是否需要支持离线模式？',
          '预期的用户规模和数据量级是多少？',
        ],
        assumptions: [
          '用户具备基本的技术操作能力',
          '网络连接稳定可用',
        ],
        outOfScope: [
          '原生移动端应用',
          '国际化多语言支持',
        ],
      },
    };
  }

  async generateDesign(
    input: GenerateDesignInput,
    _context?: AIInvocationContext,
    options?: GenerateDesignOptions,
  ): Promise<GenerateDesignOutput> {
    const base = this.buildMockDesignOutput(input);
    if (options?.phase === 'design') {
      return {
        design: base.design,
        demo: base.demo,
        demoPages: [],
        designArtifact: {
          html: this.buildMockDesignArtifactHtml(input, base),
          generatedAt: new Date().toISOString(),
        },
      };
    }
    return base;
  }

  /** 设计阶段占位 HTML（无 od / CI 环境也能跑通预览链路）。 */
  private buildMockDesignArtifactHtml(input: GenerateDesignInput, base: GenerateDesignOutput): string {
    const title = input.requirementTitle || 'FlowX 设计稿';
    const pages = base.design.pages
      .map(
        (p) =>
          `<section class="card"><h2>${p.name}<span class="route">${p.route}</span></h2><pre>${p.layout}</pre><div class="tags">${p.keyComponents
            .map((c) => `<span class="tag">${c}</span>`)
            .join('')}</div></section>`,
      )
      .join('\n');
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · 设计稿</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; background: #f6f7f9; color: #16181d; }
header { padding: 32px 40px; background: linear-gradient(135deg, #4f46e5, #0ea5e9); color: #fff; }
header h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: -0.01em; }
header p { margin: 0; opacity: 0.92; font-size: 14px; max-width: 60ch; }
main { padding: 28px 40px; display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 20px; box-shadow: 0 1px 2px rgba(16,24,40,.04); }
.card h2 { margin: 0 0 12px; font-size: 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.route { font: 500 12px ui-monospace, monospace; color: #6366f1; background: #eef2ff; padding: 2px 8px; border-radius: 999px; }
pre { margin: 0 0 12px; white-space: pre-wrap; font: 12px/1.6 ui-monospace, monospace; color: #475569; background: #f8fafc; padding: 12px; border-radius: 8px; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { font-size: 12px; background: #f1f5f9; color: #334155; padding: 3px 9px; border-radius: 999px; }
footer { padding: 20px 40px 40px; color: #64748b; font-size: 13px; }
</style>
</head>
<body>
<header><h1>${title}</h1><p>${base.design.overview}</p></header>
<main>${pages}</main>
<footer>Mock 设计稿占位 · 真实环境由 OpenDesign 设计系统驱动生成。场景：${base.design.demoScenario.split('\n')[0]}</footer>
</body>
</html>`;
  }

  private buildMockDesignOutput(input: GenerateDesignInput): GenerateDesignOutput {
    return {
      design: {
        overview: '采用简洁直观的界面设计，遵循现有设计系统规范，确保一致性和低学习成本。',
        pages: [
          {
            name: '列表页',
            route: '/feature',
            layout: '[顶部导航栏]\n[搜索栏 | 筛选器]\n[数据表格 / 卡片列表]\n[分页器]',
            keyComponents: ['DataTable', 'SearchBar', 'FilterPanel', 'Pagination'],
            interactions: [
              '输入搜索关键词实时过滤列表',
              '点击行项进入详情页',
              '切换筛选条件刷新数据',
            ],
          },
          {
            name: '详情页',
            route: '/feature/:id',
            layout: '[顶部导航栏 | 返回按钮]\n[详情头部: 标题 + 状态标签]\n[标签页: 基本信息 | 操作记录]\n[操作栏: 编辑 | 删除]',
            keyComponents: ['DetailHeader', 'TabPanel', 'ActionToolbar'],
            interactions: [
              '切换标签页查看不同信息区域',
              '点击编辑进入编辑模式',
              '删除前弹出确认对话框',
            ],
          },
        ],
        demoScenario: '1. 进入列表页，查看所有数据项\n2. 在搜索栏输入关键词，观察列表实时过滤\n3. 点击某一项进入详情页\n4. 在详情页查看完整信息\n5. 返回列表页',
        designRationale: '采用列表-详情的经典布局模式，与系统现有页面保持一致。搜索和筛选放在列表上方便于快速定位，详情页使用标签页组织信息避免页面过长。',
      },
      demo: {
        summary: '验证列表到详情的主操作链路是否清晰可用。',
        flows: [
          {
            name: '列表到详情',
            goal: '确认用户能从列表快速定位并进入详情',
            entry: '列表页默认入口',
            states: ['默认列表', '搜索过滤后', '详情查看'],
          },
        ],
        scope: {
          included: ['列表浏览', '搜索筛选', '详情查看'],
          excluded: ['真实接口联调', '编辑提交流程'],
        },
        knownGaps: ['当前演示使用 mock 数据，不包含持久化状态'],
      },
      demoPages: [
        {
          route: 'flowx-demo',
          navLabel: '通知中心',
          componentName: 'FlowxDemoHubPage',
          componentCode: input.repositoryComponentContext
            ? `import React from 'react';\nimport { Link } from 'react-router-dom';\nimport { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';\n\nexport function FlowxDemoHubPage() {\n  return (\n    <div className="flex flex-col gap-6 p-6 max-w-lg">\n      <div>\n        <h1 className="text-2xl font-semibold tracking-tight">FlowX Demo</h1>\n        <p className="text-sm text-muted-foreground mt-1">从本页进入各演示场景，无需手输子路径 URL。</p>\n      </div>\n      <Card>\n        <CardHeader>\n          <CardTitle className="text-base">演示入口</CardTitle>\n        </CardHeader>\n        <CardContent className="flex flex-col gap-2">\n          <Link to="feature-list" className="text-primary underline underline-offset-4 hover:text-primary/90">\n            功能列表场景\n          </Link>\n        </CardContent>\n      </Card>\n    </div>\n  );\n}\n`
            : `import React from 'react';\nimport { Link } from 'react-router-dom';\n\n/** 构思阶段极简入口页：真实环境应由 grounded 仓库组件替换样式。 */\nexport function FlowxDemoHubPage() {\n  return (\n    <div style={{ padding: 24, maxWidth: 480 }}>\n      <h1 style={{ fontSize: 22, marginBottom: 8 }}>FlowX Demo</h1>\n      <p style={{ fontSize: 14, color: '#555', marginBottom: 16 }}>从本页进入子演示，无需手输 URL。</p>\n      <Link to="feature-list">功能列表场景 →</Link>\n    </div>\n  );\n}\n`,
          mockData: { links: [{ label: '功能列表场景', to: 'feature-list' }] },
          filePath: 'src/pages/flowx-demo/FlowxDemoHubPage.tsx',
        },
        {
          route: 'flowx-demo/feature-list',
          componentName: 'FeatureListDemoPage',
          componentCode: input.repositoryComponentContext
            ? `import React from 'react';\nimport { PageHeader } from '../../components/PageHeader';\nimport { Card, CardContent, CardHeader } from '../../components/ui/card';\nimport { Button } from '../../components/ui/button';\nimport { Badge } from '../../components/ui/badge';\nimport { Input } from '../../components/ui/input';\n\nexport function FeatureListDemoPage() {\n  const features = mockData.features;\n  return (\n    <div className="flex flex-col gap-6 p-6">\n      <PageHeader eyebrow="Features" title="功能列表" description="管理所有功能" />\n      <Card>\n        <CardHeader><Input placeholder="搜索功能..." /></CardHeader>\n        <CardContent>\n          {features.map((f: any) => (\n            <div key={f.id} className="flex items-center justify-between border-b py-3">\n              <div>\n                <p className="font-medium">{f.name}</p>\n                <p className="text-sm text-muted-foreground">{f.description}</p>\n              </div>\n              <Badge>{f.status}</Badge>\n            </div>\n          ))}\n        </CardContent>\n      </Card>\n    </div>\n  );\n}\n`
            : `import React from 'react';\n\n/** 构思阶段未注入仓库扫描上下文时的极简占位（仅满足 schema；真实 Demo 应基于 grounded 仓库）。 */\nconst mockData = { features: [{ id: '1', name: '示例', description: 'Brief-only preview', status: 'active' }] };\n\nexport function FeatureListDemoPage() {\n  const features = mockData.features;\n  return (\n    <div style={{ padding: 24 }}>\n      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Preview</h1>\n      <ul>\n        {features.map((f) => (\n          <li key={f.id}>{f.name}</li>\n        ))}\n      </ul>\n    </div>\n  );\n}\n`,
          mockData: {
            features: [
              { id: '1', name: '用户管理', description: '管理用户账号和权限', status: 'active' },
              { id: '2', name: '数据导出', description: '支持 CSV 和 Excel 导出', status: 'draft' },
              { id: '3', name: '通知中心', description: '站内消息和推送通知', status: 'active' },
            ],
          },
          filePath: 'src/pages/flowx-demo/FeatureListDemoPage.tsx',
        },
      ],
    };
  }

  async splitTasks(input: SplitTasksInput, _context?: AIInvocationContext): Promise<SplitTasksOutput> {
    const workspaceName = input.workspace?.name;
    return {
      tasks: createBaselineTasks(
        workspaceName ? `${input.requirement.title} in ${workspaceName}` : input.requirement.title,
      ),
      ambiguities: [
        'Whether execution should apply real patches or only store generated patch metadata in MVP.',
        'Whether human review decisions should be recorded per issue or per workflow run.',
      ],
      risks: [
        'Stage outputs can drift without strict schema validation.',
        'Workflow state can become inconsistent if stage transitions are not centralized.',
      ],
    };
  }

  async generatePlan(input: GeneratePlanInput, _context?: AIInvocationContext): Promise<GeneratePlanOutput> {
    const taskTitles = input.tasks.map((task) => task.title);
    return {
      summary: `Implement a staged workflow service for "${input.requirement.title}" with explicit confirmation gates.`,
      implementationPlan: [
        'Create database models for workflow state, stage execution, tasks, plans, execution, and review artifacts.',
        'Implement centralized state machine guards for workflow and stage transitions.',
        `Expose REST APIs for confirmed tasks: ${taskTitles.join(', ')}.`,
        'Store AI stage outputs in structured JSON fields for reuse by later stages.',
      ],
      filesToModify: [
        'apps/api/src/workflow/workflow.service.ts',
        'apps/api/src/workflow/workflow.controller.ts',
        'prisma/schema.prisma',
      ],
      newFiles: [
        'apps/api/src/common/workflow-state-machine.ts',
        'apps/api/src/ai/ai-executor.ts',
        'apps/web/src/App.tsx',
      ],
      riskPoints: [
        'Prompt/template versions should be tracked to explain why outputs differ across runs.',
        'Rejected stages must not leave stale domain artifacts marked as confirmed.',
      ],
    };
  }

  async executeTask(input: ExecuteTaskInput, _context?: AIInvocationContext): Promise<ExecuteTaskOutput> {
    return {
      patchSummary: `Execute approved plan for "${input.requirement.title}" across backend workflow orchestration and operator UI.`,
      changedFiles: [
        ...input.plan.filesToModify,
        ...input.plan.newFiles,
      ],
      codeChanges: [
        {
          file: 'apps/api/src/workflow/workflow.service.ts',
          changeType: 'update',
          summary: 'Add execution orchestration and persistence for confirmed plan output.',
        },
        {
          file: 'apps/api/src/workflow/workflow.controller.ts',
          changeType: 'update',
          summary: 'Expose execution and review endpoints guarded by workflow status.',
        },
        {
          file: 'apps/web/src/App.tsx',
          changeType: 'update',
          summary: 'Render execution and review actions in the workflow operator console.',
        },
      ],
      diffArtifacts: [
        {
          repository: input.workspace?.repositories[0]?.name ?? 'mock-repository',
          branch:
            input.workspace?.repositories[0]?.currentBranch ??
            input.workspace?.repositories[0]?.defaultBranch ??
            'mock-branch',
          localPath: input.workspace?.repositories[0]?.localPath ?? '/mock/path',
          diffStat: '3 files changed, 42 insertions(+), 8 deletions(-)',
          diffText: 'diff --git a/apps/api/src/workflow/workflow.service.ts b/apps/api/src/workflow/workflow.service.ts\n...[mock diff]',
          untrackedFiles: [],
        },
      ],
    };
  }

  async reviewCode(_input: ReviewCodeInput, _context?: AIInvocationContext): Promise<ReviewCodeOutput> {
    return {
      issues: ['Execution result currently stores patch metadata instead of applying VCS patches.'],
      bugs: ['No retry policy is defined for transient AI provider failures.'],
      missingTests: [
        'Workflow status transition tests for reject and rework branches.',
        'API integration tests for execution and review endpoints.',
      ],
      suggestions: [
        'Persist prompt version per stage execution for traceability.',
        'Add idempotency protection for run-stage endpoints.',
      ],
      impactScope: ['Backend workflow orchestration', 'Operator review UI', 'Prisma data model'],
    };
  }
}
