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
import type { Briefing } from '../types';

export function BriefingDetailPage() {
  const { briefingId } = useParams();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const toast = useToast();

  async function refresh() {
    if (!briefingId) {
      return;
    }
    setLoading(true);
    try {
      setBriefing(await api.getBriefing(briefingId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载简报失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [briefingId]);

  async function resend() {
    if (!briefingId) {
      return;
    }
    setSending(true);
    try {
      await api.sendBriefing(briefingId);
      await refresh();
      toast.success('简报已重新发送');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重新发送失败');
    } finally {
      setSending(false);
    }
  }

  if (loading && !briefing) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  if (!briefing) {
    return <p className="text-sm text-muted-foreground">简报不存在或无法加载。</p>;
  }

  const logs = briefing.deliveryLogs ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Briefing"
        title="简报详情"
        description={`${briefing.date.slice(0, 10)} · ${briefing.eventCount} 个事件`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={resend} disabled={sending}>
              {sending ? '发送中...' : '重新发送'}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/briefings">返回简报列表</Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{briefing.status}</Badge>
        <Badge variant="outline">事件 {briefing.eventCount}</Badge>
        <Badge variant={briefing.sentAt ? 'default' : 'outline'}>
          {briefing.sentAt ? '已发送' : '未发送'}
        </Badge>
      </div>

      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardContent className="grid gap-2 p-5 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">生成时间（北京时间）</span>
            <p className="font-medium text-foreground">{formatBeijingDateTime(briefing.generatedAt)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">发送时间（北京时间）</span>
            <p className="font-medium text-foreground">{formatBeijingDateTime(briefing.sentAt)}</p>
          </div>
          {briefing.errorMessage ? (
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">最近错误</span>
              <p className="font-medium text-destructive">{briefing.errorMessage}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Content" title="简报内容" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <BriefingMarkdownView markdown={briefing.markdownContent} />
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

