import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { List } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
  icon?: LucideIcon;
  loadErrorFallback?: string;
};

type DocumentHeading = {
  id: string;
  level: 2 | 3;
  title: string;
};

function isInternalAppPath(href: string | undefined): href is string {
  return Boolean(href && href.startsWith('/') && !href.startsWith('//'));
}

function plainText(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => plainText(item)).join('');
  }
  return '';
}

function headingTitle(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+#+\s*$/, '')
    .trim();
}

function headingId(title: string, index: number) {
  const normalized = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return normalized || `section-${index + 1}`;
}

function extractHeadings(markdown: string): DocumentHeading[] {
  const headings: DocumentHeading[] = [];
  let inCodeBlock = false;

  markdown.split('\n').forEach((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) {
      return;
    }
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) {
      return;
    }

    const title = headingTitle(match[2]);
    const baseId = headingId(title, headings.length);
    const duplicateCount = headings.filter((heading) => heading.id === baseId || heading.id.startsWith(`${baseId}-`)).length;
    headings.push({
      id: duplicateCount > 0 ? `${baseId}-${duplicateCount + 1}` : baseId,
      level: match[1].length as 2 | 3,
      title,
    });
  });

  return headings;
}

export function MarkdownDocPage({
  markdownUrl,
  eyebrow,
  title,
  description,
  icon,
  loadErrorFallback = '文档加载失败',
}: MarkdownDocPageProps) {
  const [markdown, setMarkdown] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const headings = useMemo(() => extractHeadings(markdown), [markdown]);

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

  let renderedHeadingIndex = 0;

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} icon={icon} />
      <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        {headings.length > 0 ? (
          <aside className="lg:sticky lg:top-6">
            <div className="border-b border-border pb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <div className="flex items-center gap-2">
                <List aria-hidden="true" className="h-4 w-4" />
                章节导航
              </div>
            </div>
            <nav aria-label="文档章节" className="mt-2 flex flex-col gap-0.5">
              {headings.map((heading) => (
                <a
                  key={heading.id}
                  href={`#${heading.id}`}
                  className={[
                    'border-l-2 border-transparent py-1.5 text-sm leading-5 text-muted-foreground no-underline transition-colors hover:border-primary hover:text-foreground',
                    heading.level === 3 ? 'pl-5' : 'pl-3 font-medium',
                  ].join(' ')}
                >
                  {heading.title}
                </a>
              ))}
            </nav>
          </aside>
        ) : null}
        <Card className="min-w-0 rounded-md border border-border bg-card">
          <CardContent className="p-6 sm:p-8">
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
              <article className="max-w-4xl text-sm leading-7 text-foreground">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="mb-5 text-xl font-semibold leading-8 text-foreground">{children}</h1>
                    ),
                    h2: ({ children }) => {
                      const heading = headings[renderedHeadingIndex];
                      renderedHeadingIndex += 1;
                      return (
                        <h2
                          id={heading?.id}
                          className="mt-10 mb-3 scroll-mt-6 border-b border-border pb-2 text-xl font-semibold leading-7 text-foreground first:mt-0"
                        >
                          {children}
                        </h2>
                      );
                    },
                    h3: ({ children }) => {
                      const heading = headings[renderedHeadingIndex];
                      renderedHeadingIndex += 1;
                      return (
                        <h3
                          id={heading?.id}
                          className="mt-7 mb-2 scroll-mt-6 text-base font-semibold leading-6 text-foreground"
                        >
                          {children}
                        </h3>
                      );
                    },
                    p: ({ children }) => <p className="my-4">{children}</p>,
                    ul: ({ children }) => (
                      <ul className="my-4 list-disc space-y-1 pl-6">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="my-4 list-decimal space-y-1 pl-6">{children}</ol>
                    ),
                    li: ({ children }) => <li>{children}</li>,
                    blockquote: ({ children }) => (
                      <blockquote className="my-5 border-l-2 border-primary/40 bg-muted/60 px-4 py-2 text-muted-foreground">
                        {children}
                      </blockquote>
                    ),
                    code: ({ children, className }) => (
                      <code className={className ? 'font-mono text-xs' : 'rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground'}>
                        {children}
                      </code>
                    ),
                    pre: ({ children }) => (
                      <pre className="my-5 overflow-x-auto rounded-md border border-border bg-muted p-4 text-xs leading-6 text-foreground">
                        {children}
                      </pre>
                    ),
                    a: ({ href, children }) =>
                      isInternalAppPath(href) ? (
                        <Link to={href} className="text-primary underline underline-offset-2">
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
                      <div className="my-5 overflow-x-auto">
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
      </div>
    </>
  );
}
