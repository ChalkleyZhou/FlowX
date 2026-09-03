import { MarkdownDocPage } from '../components/MarkdownDocPage';
import { SquareTerminal } from 'lucide-react';

export function LocalAgentGuidePage() {
  return (
    <MarkdownDocPage
      markdownUrl="/local-agent-guide.md"
      eyebrow="Local Agent"
      title="本地 Agent"
      description="在本机终端执行 curl 安装脚本，再 login，即可连接 Cursor / Codex。"
      icon={SquareTerminal}
      loadErrorFallback="加载本地 Agent 指南失败"
    />
  );
}
