import { MarkdownDocPage } from '../components/MarkdownDocPage';
import { BookOpen, CircleHelp, Network, Rocket, Workflow } from 'lucide-react';

export function UserManualPage() {
  return (
    <MarkdownDocPage
      markdownUrl="/user-manual.md"
      eyebrow="Manual"
      title="使用手册"
      description="系统内置用户操作手册，包含标准流程与常见问题。"
      icon={BookOpen}
      menuItems={[
        {
          anchor: '快速上手',
          title: '快速上手',
          description: '完成登录、凭据、工作区和需求准备。',
          icon: Rocket,
        },
        {
          anchor: '从需求到交付',
          title: '标准研发流程',
          description: '了解定稿、执行、审查与人工确认。',
          icon: Workflow,
        },
        {
          anchor: '本地-agent-与-opendesign',
          title: '本地设计与 MCP',
          description: '在 Cursor Agent 中配置并使用 FlowX MCP。',
          icon: Network,
        },
        {
          anchor: '常见问题',
          title: '问题排查',
          description: '快速定位工作流、部署和凭据问题。',
          icon: CircleHelp,
        },
      ]}
      loadErrorFallback="加载使用手册失败"
    />
  );
}
