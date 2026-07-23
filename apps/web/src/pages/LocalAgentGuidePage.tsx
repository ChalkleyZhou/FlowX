import { MarkdownDocPage } from '../components/MarkdownDocPage';
import { SquareTerminal } from 'lucide-react';

export function LocalAgentGuidePage() {
  return (
    <MarkdownDocPage
      markdownUrl="/local-agent-guide.md"
      eyebrow="Local Agent"
      title="本地 Agent"
      description="安装并启动 @flowx-ai/local，在本机连接 FlowX 与 IDE / OpenDesign。"
      icon={SquareTerminal}
      loadErrorFallback="加载本地 Agent 指南失败"
    />
  );
}
