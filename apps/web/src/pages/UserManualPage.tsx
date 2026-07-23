import { MarkdownDocPage } from '../components/MarkdownDocPage';

export function UserManualPage() {
  return (
    <MarkdownDocPage
      markdownUrl="/user-manual.md"
      eyebrow="Manual"
      title="使用手册"
      description="系统内置用户操作手册，包含标准流程与常见问题。"
      loadErrorFallback="加载使用手册失败"
    />
  );
}
