import { Injectable } from '@nestjs/common';
import {
  BrainstormInput,
  BrainstormOutput,
  ExecuteTaskInput,
  ExecuteTaskOutput,
  GenerateDesignInput,
  GenerateDesignOutput,
  GeneratePlanInput,
  GeneratePlanOutput,
  ReviewCodeInput,
  ReviewCodeOutput,
  SplitTaskItem,
  SplitTasksInput,
  SplitTasksOutput,
} from '../common/types';
import { AIExecutor } from './ai-executor';

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
  async brainstorm(input: BrainstormInput): Promise<BrainstormOutput> {
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

  async generateDesign(input: GenerateDesignInput): Promise<GenerateDesignOutput> {
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
        dataModels: [
          'Feature: { id, name, status, createdAt, updatedAt }',
          'FeatureDetail: { id, featureId, description, metadata }',
        ],
        apiEndpoints: [
          { method: 'GET', path: '/api/features', purpose: '获取功能列表（支持搜索和分页）' },
          { method: 'GET', path: '/api/features/:id', purpose: '获取功能详情' },
          { method: 'POST', path: '/api/features', purpose: '创建新功能' },
          { method: 'PATCH', path: '/api/features/:id', purpose: '更新功能信息' },
        ],
        designRationale: '采用列表-详情的经典布局模式，与系统现有页面保持一致。搜索和筛选放在列表上方便于快速定位，详情页使用标签页组织信息避免页面过长。',
      },
      demoPages: input.repositoryComponentContext
        ? [
            {
              route: '/flowx-demo/feature-list',
              componentName: 'FeatureListDemoPage',
              componentCode: `import React from 'react';\nimport { PageHeader } from '../components/PageHeader';\nimport { Card, CardContent, CardHeader } from '../components/ui/card';\nimport { Button } from '../components/ui/button';\nimport { Badge } from '../components/ui/badge';\nimport { Input } from '../components/ui/input';\n\nexport function FeatureListDemoPage() {\n  const features = mockData.features;\n  return (\n    <div className="flex flex-col gap-6 p-6">\n      <PageHeader eyebrow="Features" title="功能列表" description="管理所有功能" />\n      <Card>\n        <CardHeader><Input placeholder="搜索功能..." /></CardHeader>\n        <CardContent>\n          {features.map((f: any) => (\n            <div key={f.id} className="flex items-center justify-between border-b py-3">\n              <div>\n                <p className="font-medium">{f.name}</p>\n                <p className="text-sm text-muted-foreground">{f.description}</p>\n              </div>\n              <Badge>{f.status}</Badge>\n            </div>\n          ))}\n        </CardContent>\n      </Card>\n    </div>\n  );\n}\n`,
              mockData: {
                features: [
                  { id: '1', name: '用户管理', description: '管理用户账号和权限', status: 'active' },
                  { id: '2', name: '数据导出', description: '支持 CSV 和 Excel 导出', status: 'draft' },
                  { id: '3', name: '通知中心', description: '站内消息和推送通知', status: 'active' },
                ],
              },
              filePath: 'src/pages/FeatureListDemoPage.tsx',
            },
          ]
        : undefined,
    };
  }

  async splitTasks(input: SplitTasksInput): Promise<SplitTasksOutput> {
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

  async generatePlan(input: GeneratePlanInput): Promise<GeneratePlanOutput> {
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

  async executeTask(input: ExecuteTaskInput): Promise<ExecuteTaskOutput> {
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

  async reviewCode(_input: ReviewCodeInput): Promise<ReviewCodeOutput> {
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
