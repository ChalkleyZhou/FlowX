import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PageHeader } from '../components/PageHeader';
import { Card, CardContent } from '../components/ui/card';
import { Spinner } from '../components/ui/spinner';

const USER_MANUAL_URL = '/user-manual.md';

export function UserManualPage() {
  const [markdown, setMarkdown] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadManual() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(USER_MANUAL_URL, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`加载失败（HTTP ${response.status}）`);
        }
        const rawBuffer = await response.arrayBuffer();
        const content = new TextDecoder('utf-8').decode(rawBuffer).replace(/^\uFEFF/, '');
        if (!cancelled) {
          setMarkdown(content);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载使用手册失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadManual();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Manual"
        title="使用手册"
        description="系统内置用户操作手册，包含标准流程与常见问题。"
      />
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardContent className="p-6">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : null}

          {!loading && error ? (
            <p className="text-sm text-destructive">手册加载失败：{error}</p>
          ) : null}

          {!loading && !error ? (
            <article className="space-y-3 text-sm leading-7 text-foreground">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => <h1 className="mb-4 text-3xl font-semibold text-foreground">{children}</h1>,
                  h2: ({ children }) => <h2 className="mt-8 mb-3 text-2xl font-semibold text-foreground">{children}</h2>,
                  h3: ({ children }) => <h3 className="mt-6 mb-2 text-lg font-semibold text-foreground">{children}</h3>,
                  p: ({ children }) => <p className="my-3">{children}</p>,
                  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>,
                  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>,
                  li: ({ children }) => <li>{children}</li>,
                  blockquote: ({ children }) => (
                    <blockquote className="my-4 border-l-4 border-border bg-muted px-4 py-2 text-muted-foreground">{children}</blockquote>
                  ),
                  code: ({ children }) => (
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{children}</code>
                  ),
                  pre: ({ children }) => (
                    <pre className="my-4 overflow-x-auto rounded-lg border border-border bg-muted p-3 text-xs leading-6 text-foreground">
                      {children}
                    </pre>
                  ),
                  a: ({ href, children }) => (
                    <a href={href} className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {markdown}
              </ReactMarkdown>
            </article>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
