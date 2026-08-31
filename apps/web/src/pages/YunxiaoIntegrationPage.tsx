import { useEffect, useState } from 'react';
import { PlugZap } from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useToast } from '../components/ui/toast';
import type { YunxiaoIntegrationStatus } from '../types';

export function YunxiaoIntegrationPage() {
  const { session } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<YunxiaoIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isAdmin = session?.organization?.role === 'admin';

  useEffect(() => {
    let cancelled = false;
    api.getYunxiaoIntegration()
      .then((result) => {
        if (!cancelled) {
          setStatus(result);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : '加载云效集成状态失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [toast]);

  async function toggleEnabled() {
    if (!status || !isAdmin) {
      return;
    }
    setSaving(true);
    try {
      setStatus(await api.updateYunxiaoIntegration({ enabled: !status.enabled }));
      toast.success(status.enabled ? '云效集成已停用' : '云效集成已启用');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新云效集成失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Integration"
        title="云效集成"
        description="接收云效工作项通知，并按负责人发送钉钉工作通知。"
        icon={PlugZap}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-4">
            <span>云效 Webhook</span>
            <span className={status?.enabled ? 'text-sm font-medium text-success' : 'text-sm font-medium text-muted-foreground'}>
              {status?.enabled ? '已启用' : '已停用'}
            </span>
          </CardTitle>
          <CardDescription>
            停用后不会处理新的云效通知，已有配置和历史记录会保留。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <p className="text-sm text-muted-foreground">正在加载...</p>
          ) : status ? (
            <>
              <label className="flex items-start gap-3 rounded-md border border-border p-4">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                  checked={status.enabled}
                  disabled={saving || !isAdmin}
                  onChange={() => void toggleEnabled()}
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">启用云效通知</span>
                  <span className="block text-sm text-muted-foreground">
                    {isAdmin ? '管理员可以随时切换。' : '只有组织管理员可以修改。'}
                  </span>
                </span>
              </label>
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div className="rounded-md bg-muted p-3">
                  <div className="text-muted-foreground">服务配置</div>
                  <div className="mt-1 font-medium">{status.configured ? '已配置 Secret' : '未配置 Secret'}</div>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <div className="text-muted-foreground">Webhook 地址</div>
                  <code className="mt-1 block break-all font-mono text-xs">{status.webhookPath}</code>
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
