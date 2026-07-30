import { EmptyState } from './EmptyState';
import { SectionHeader } from './SectionHeader';
import { Card, CardContent, CardHeader } from './ui/card';

interface DesignDocumentPanelProps {
  output: unknown;
}

function extractDesignMarkdown(output: unknown): string | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null;
  }

  const markdown = (output as { markdown?: unknown }).markdown;
  return typeof markdown === 'string' && markdown.trim() ? markdown : null;
}

export function DesignDocumentPanel({ output }: DesignDocumentPanelProps) {
  const markdown = extractDesignMarkdown(output);

  return (
    <Card className="rounded-md border-border bg-card">
      <CardHeader className="p-5 pb-0">
        <SectionHeader eyebrow="Design Doc" title="设计文档" />
      </CardHeader>
      <CardContent className="p-5 pt-4">
        {markdown ? (
          <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{markdown}</pre>
        ) : (
          <EmptyState description="尚未提交设计文档" />
        )}
      </CardContent>
    </Card>
  );
}
