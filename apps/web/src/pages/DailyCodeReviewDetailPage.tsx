import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { BriefingMarkdownView } from '../components/BriefingMarkdownView';
import { PageHeader } from '../components/PageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import { formatBeijingDateTime } from '../utils/datetime';
import type { DailyCodeReview, DailyCodeReviewUnit } from '../types';

const UNIT_STATUS_LABELS: Record<string, string> = {
  COMPLETED: '已完成',
  SKIPPED_NO_SKILL: '未配置 review skill',
  SKIPPED_NO_CHANGES: '无变更',
  SKIPPED_NO_REPO: '仓库未同步',
  FAILED: '失败',
};

function unitCountLabel(units: DailyCodeReviewUnit[]) {
  if (units.length === 0) {
    return '0 个审查单元';
  }
  const completed = units.filter((unit) => unit.status === 'COMPLETED').length;
  return `${units.length} 个审查单元 · ${completed} 项已完成`;
}

export function DailyCodeReviewDetailPage() {
  const { reviewId } = useParams();
  const [review, setReview] = useState<DailyCodeReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const toast = useToast();

  async function refresh() {
    if (!reviewId) {
      return;
    }
    setLoading(true);
    try {
      setReview(await api.getDailyCodeReview(reviewId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载 Code Review 失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [reviewId]);

  useEffect(() => {
    if (review?.status !== 'GENERATING') {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [review?.status, reviewId]);

  async function resend() {
    if (!reviewId) {
      return;
    }
    setSending(true);
    try {
      await api.sendDailyCodeReview(reviewId);
      await refresh();
      toast.success('Code Review 已重新发送');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重新发送失败');
    } finally {
      setSending(false);
    }
  }

  if (loading && !review) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  if (!review) {
    return <p className="text-sm text-muted-foreground">Code Review 记录不存在或无法加载。</p>;
  }

  const logs = review.deliveryLogs ?? [];
  const units = review.unitsJson ?? [];
  const isGenerating = review.status === 'GENERATING';

  return (
    <>
      <PageHeader
        eyebrow="Code Review"
        title="每日 Code Review 详情"
        description={`${review.date.slice(0, 10)} · ${unitCountLabel(units)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={resend} disabled={sending || isGenerating}>
              {sending ? '发送中...' : '重新发送'}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/code-reviews">返回列表</Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{review.status}</Badge>
        <Badge variant={review.sentAt ? 'default' : 'outline'}>
          {review.sentAt ? '已发送' : '未发送'}
        </Badge>
      </div>

      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardContent className="grid gap-2 p-5 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">生成时间（北京时间）</span>
            <p className="font-medium text-foreground">{formatBeijingDateTime(review.generatedAt)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">发送时间（北京时间）</span>
            <p className="font-medium text-foreground">{formatBeijingDateTime(review.sentAt)}</p>
          </div>
          {review.errorMessage ? (
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">最近错误</span>
              <p className="font-medium text-destructive">{review.errorMessage}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {units.length > 0 ? (
        <Card className="rounded-2xl border border-border bg-card shadow-sm">
          <CardHeader className="pb-4">
            <SectionHeader eyebrow="Units" title="按仓库 / 分支" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-5 pt-0">
            {units.map((unit) => (
              <div key={`${unit.repositoryName}:${unit.ref}`} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">
                    {unit.repositoryName} / {unit.ref}
                  </p>
                  <Badge variant="secondary">
                    {UNIT_STATUS_LABELS[unit.status] ?? unit.status}
                  </Badge>
                </div>
                {unit.commits.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {unit.commits.map((commit) => (
                      <li key={commit.id}>
                        <code className="text-xs">{commit.id.slice(0, 12)}</code>{' '}
                        {commit.message.split('\n')[0]}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {unit.skillHint ? (
                  <p className="mt-2 text-sm text-muted-foreground">{unit.skillHint}</p>
                ) : null}
                {unit.errorMessage ? (
                  <p className="mt-2 text-sm text-destructive">{unit.errorMessage}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Content" title="审查报告" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <BriefingMarkdownView markdown={review.markdownContent} />
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Delivery" title="投递记录" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {logs.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">目标</th>
                    <th className="px-4 py-3 font-medium">渠道</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">投递时间</th>
                    <th className="px-4 py-3 font-medium">错误</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-t border-border">
                      <td className="px-4 py-3">{log.deliveryTarget?.name ?? log.deliveryTargetId}</td>
                      <td className="px-4 py-3">{log.channel}</td>
                      <td className="px-4 py-3"><Badge variant="secondary">{log.status}</Badge></td>
                      <td className="px-4 py-3">{formatBeijingDateTime(log.sentAt ?? log.createdAt)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{log.errorMessage ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无投递记录。</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
