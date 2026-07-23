import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { EmptyState } from './EmptyState';

interface DiffViewerPanelProps {
  filePath?: string | null;
  repository: string;
  branch: string;
  diffText?: string | null;
}

export function DiffViewerPanel({
  filePath,
  repository,
  branch,
  diffText,
}: DiffViewerPanelProps) {
  return (
    <Card className="rounded-md border-border bg-muted shadow-none">
      <CardHeader className="p-4 pb-0">
        <div>
          <CardTitle className="text-sm">
            {filePath ?? '选择一个文件查看差异'}
          </CardTitle>
          <div className="mt-2 flex flex-wrap gap-3">
            <Badge variant="outline">{repository}</Badge>
            <Badge variant="default">{branch}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {diffText ? (
          <ScrollArea className="h-[36rem] rounded-md">
            <pre className="m-0 max-h-[720px] overflow-auto rounded-md border border-border bg-foreground px-4 py-[14px] font-mono text-xs leading-[1.6] text-background overflow-wrap-anywhere whitespace-pre-wrap">
              {diffText}
            </pre>
          </ScrollArea>
        ) : (
          <EmptyState description="当前仓库没有可查看的差异内容。" />
        )}
      </CardContent>
    </Card>
  );
}
