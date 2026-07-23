import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PageHeader } from './PageHeader';
import { Card, CardContent } from './ui/card';
import { Spinner } from './ui/spinner';

export type MarkdownDocPageProps = {
  markdownUrl: string;
  eyebrow: string;
  title: string;
  description: string;
  loadErrorFallback?: string;
};

function isInternalAppPath(href: string | undefined): href is string {
  return Boolean(href && href.startsWith('/') && !href.startsWith('//'));
}

export function MarkdownDocPage({
  markdownUrl,
  eyebrow,
  title,
  description,
  loadErrorFallback = '文档加载失败',
}: MarkdownDocPageProps) {
  const [markdown, setMarkdown] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMarkdown() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(markdownUrl, { cache: 'no-store' });
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
          setError(err instanceof Error ? err.message : loadErrorFallback);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadMarkdown();
    return () => {
      cancelled = true;
    };
  }, [markdownUrl, loadErrorFallback]);

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardContent className="p-6">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : null}

          {!loading && error ? (
            <p className="text-sm text-destructive">
              {loadErrorFallback}：{error}
            </p>
          ) : null}

          {!loading && !error ? (
            <article className="space-y-3 text-sm leading-7 text-foreground">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h1 className="mb-4 text-3xl font-semibold text-foreground">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="mt-8 mb-3 text-2xl font-semibold text-foreground">{children}</h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="mt-6 mb-2 text-lg font-semibold text-foreground">{children}</h3>
                  ),
                  p: ({ children }) => <p className="my-3">{children}</p>,
                  ul: ({ children }) => (
                    <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>
                  ),
                  li: ({ children }) => <li>{children}</li>,
                  blockquote: ({ children }) => (
                    <blockquote className="my-4 border-l-4 border-border bg-muted px-4 py-2 text-muted-foreground">
                      {children}
                    </blockquote>
                  ),
                  code: ({ children }) => (
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                      {children}
                    </code>
                  ),
                  pre: ({ children }) => (
                    <pre className="my-4 overflow-x-auto rounded-lg border border-border bg-muted p-3 text-xs leading-6 text-foreground">
                      {children}
                    </pre>
                  ),
                  a: ({ href, children }) =>
                    isInternalAppPath(href) ? (
                      <Link
                        to={href}
                        className="text-primary underline underline-offset-2"
                      >
                        {children}
                      </Link>
                    ) : (
                      <a
                        href={href}
                        className="text-primary underline underline-offset-2"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {children}
                      </a>
                    ),
                  table: ({ children }) => (
                    <div className="my-4 overflow-x-auto">
                      <table className="w-full border-collapse text-left text-sm">{children}</table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="border border-border bg-muted px-3 py-2 font-semibold">{children}</th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-border px-3 py-2 align-top">{children}</td>
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
