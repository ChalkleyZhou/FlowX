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
    <Card className="rounded-2xl border-slate-200 bg-slate-50 shadow-none">
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
          <ScrollArea className="h-[36rem] rounded-2xl">
            <pre className="m-0 max-h-[720px] overflow-auto rounded-[14px] border border-[var(--border)] bg-slate-950 px-4 py-[14px] font-mono text-xs leading-[1.6] text-slate-200 overflow-wrap-anywhere whitespace-pre-wrap">
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
