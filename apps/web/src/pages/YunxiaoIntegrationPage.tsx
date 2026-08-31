import { useEffect, useState } from 'react';
import { PlugZap, Save } from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { useToast } from '../components/ui/toast';
import type { YunxiaoIntegrationStatus } from '../types';

export function YunxiaoIntegrationPage() {
  const { session } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<YunxiaoIntegrationStatus | null>(null);
  const [yunxiaoOrganizationIdentifier, setYunxiaoOrganizationIdentifier] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isAdmin = session?.organization?.role === 'admin';

  useEffect(() => {
    let cancelled = false;
    api.getYunxiaoIntegration()
      .then((result) => {
        if (!cancelled) {
          setStatus(result);
          setYunxiaoOrganizationIdentifier(result.yunxiaoOrganizationIdentifier ?? '');
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

  async function saveOrganizationBinding() {
    if (!status || !isAdmin) {
      return;
    }
    setSaving(true);
    try {
      setStatus(await api.updateYunxiaoIntegration({
        enabled: status.enabled,
        yunxiaoOrganizationIdentifier: yunxiaoOrganizationIdentifier.trim() || null,
      }));
      toast.success('云效组织绑定已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存云效组织绑定失败');
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
              <div className="space-y-2">
                <label htmlFor="yunxiao-organization-identifier" className="text-sm font-medium">
                  云效组织 ID
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="yunxiao-organization-identifier"
                    value={yunxiaoOrganizationIdentifier}
                    onChange={(event) => setYunxiaoOrganizationIdentifier(event.target.value)}
                    placeholder="organizationIdentifier"
                    disabled={saving || !isAdmin}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void saveOrganizationBinding()}
                    disabled={saving || !isAdmin}
                  >
                    <Save size={16} />
                    保存绑定
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  填写云效 Webhook Body 中的 organizationIdentifier，只匹配当前 FlowX 组织的成员。
                </p>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
