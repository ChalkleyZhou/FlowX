import { useEffect, useMemo, useState } from 'react';
import { api, toApiUrl } from '../api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/utils';
import { copyToClipboard } from '../lib/clipboard';
import type { BriefingSource, Repository, Workspace } from '../types';

type RepositoryBinding = {
  provider: 'github' | 'gitlab';
  externalPath: string;
  host: string;
  repositoryUrl: string;
};

async function handleCopy(toast: ReturnType<typeof useToast>, label: string, value: string) {
  if (!value) {
    toast.error(`${label.trim()} 为空，请重新生成 Secret 或刷新页面`);
    return;
  }

  try {
    await copyToClipboard(value);
    toast.success(`已复制${label}`);
  } catch {
    toast.error(`复制${label}失败，请手动选中输入框内容复制`);
  }
}

function CopyField({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        readOnly
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 font-mono text-xs"
        aria-label={label}
      />
      <Button type="button" variant="outline" size="sm" disabled={!value} onClick={onCopy}>
        复制{label}
      </Button>
    </div>
  );
}

function providerLabel(provider: BriefingSource['provider']) {
  return provider === 'github' ? 'GitHub' : 'GitLab';
}

function webhookUrl(sourceId: string) {
  return toApiUrl(`/briefing-sources/${sourceId}/webhook`);
}

function WebhookSetupGuide({
  source,
  onRegenerateSecret,
}: {
  source: BriefingSource;
  onRegenerateSecret: () => void;
}) {
  const toast = useToast();
  const secret = source.webhookSecret ?? '';
  const url = webhookUrl(source.id);
  const isGitlab = source.provider === 'gitlab';

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <p className="text-sm font-medium text-foreground">在 {providerLabel(source.provider)} 配置 Webhook</p>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
        <li>复制下方 <span className="text-foreground">Webhook URL</span> 与 <span className="text-foreground">Secret</span>（由 FlowX 生成，勿在 GitLab 里再随机生成）。</li>
        <li>打开 Git 项目 Settings → Webhooks，粘贴 URL。</li>
        <li>
          {isGitlab
            ? 'Secret token 填 FlowX 的 Secret（对应请求头 X-Gitlab-Token）。'
            : 'Secret 填 FlowX 的 Secret（GitHub 使用 HMAC 签名校验）。'}
        </li>
        <li>勾选 Push、Merge request、Issue、Pipeline 等事件后保存；可用 Test 推送验证。</li>
      </ol>
      <div className="grid gap-2">
        <CopyField
          label=" URL"
          value={url}
          onCopy={() => void handleCopy(toast, ' URL', url)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <CopyField
            label=" Secret"
            value={secret}
            onCopy={() => void handleCopy(toast, ' Secret', secret)}
          />
          <Button type="button" variant="outline" size="sm" onClick={onRegenerateSecret}>
            重新生成 Secret
          </Button>
        </div>
      </div>
    </div>
  );
}

export function BriefingSourcesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sources, setSources] = useState<BriefingSource[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [repositoryId, setRepositoryId] = useState('');
  const [binding, setBinding] = useState<RepositoryBinding | null>(null);
  const [bindingError, setBindingError] = useState('');
  const [setupSourceId, setSetupSourceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bindingLoading, setBindingLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  const repositories = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId)?.repositories ?? [],
    [workspaces, workspaceId],
  );

  async function refresh(nextWorkspaceId = workspaceId) {
    if (!nextWorkspaceId) {
      return;
    }
    setSources(await api.getBriefingSources({ workspaceId: nextWorkspaceId }));
  }

  useEffect(() => {
    setLoading(true);
    api.getWorkspaces()
      .then(async (workspaceList) => {
        setWorkspaces(workspaceList);
        const firstWorkspaceId = workspaceId || workspaceList[0]?.id || '';
        setWorkspaceId(firstWorkspaceId);
        const firstRepositoryId = workspaceList[0]?.repositories[0]?.id ?? '';
        setRepositoryId(firstRepositoryId);
        if (firstWorkspaceId) {
          setSources(await api.getBriefingSources({ workspaceId: firstWorkspaceId }));
        }
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载数据源失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!workspaceId || !repositoryId) {
      setBinding(null);
      setBindingError('');
      return;
    }

    setBindingLoading(true);
    setBindingError('');
    api.resolveBriefingRepositoryBinding({ workspaceId, repositoryId })
      .then((resolved) => {
        setBinding({
          provider: resolved.provider,
          externalPath: resolved.externalPath,
          host: resolved.host,
          repositoryUrl: resolved.repositoryUrl,
        });
      })
      .catch((error) => {
        setBinding(null);
        setBindingError(error instanceof Error ? error.message : '无法解析仓库地址');
      })
      .finally(() => setBindingLoading(false));
  }, [workspaceId, repositoryId]);

  async function createSource() {
    if (!workspaceId || !repositoryId || !binding) {
      toast.error(bindingError || '请选择可识别的仓库');
      return;
    }
    setCreating(true);
    try {
      const created = await api.createBriefingSource({
        workspaceId,
        repositoryId,
      });
      setSetupSourceId(created.id);
      await refresh(workspaceId);
      toast.success('数据源已创建，请按下方步骤在 GitLab/GitHub 粘贴 URL 与 Secret');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建数据源失败');
    } finally {
      setCreating(false);
    }
  }

  async function toggleSource(source: BriefingSource) {
    await api.updateBriefingSource(source.id, { isActive: !source.isActive });
    await refresh(workspaceId);
  }

  async function deleteSource(source: BriefingSource) {
    if (!window.confirm(`确认删除 ${source.provider}://${source.externalPath} 吗？`)) {
      return;
    }
    await api.deleteBriefingSource(source.id);
    if (setupSourceId === source.id) {
      setSetupSourceId(null);
    }
    await refresh(workspaceId);
  }

  async function regenerateSecret(source: BriefingSource) {
    if (
      !window.confirm(
        '重新生成后，请同步更新 GitLab/GitHub 上的 Secret，否则 webhook 会校验失败。继续吗？',
      )
    ) {
      return;
    }
    try {
      const updated = await api.regenerateBriefingSourceWebhookSecret(source.id);
      setSetupSourceId(updated.id);
      await refresh(workspaceId);
      toast.success('已生成新 Secret，请复制并更新到 Git 平台');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重新生成失败');
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Briefing Sources"
        title="简报数据源"
        description="先在工作区创建数据源，再按列表中的 URL 与 Secret 去 GitLab/GitHub 配置 webhook。"
      />
      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Create" title="新增数据源" />
        </CardHeader>
        <CardContent className="space-y-3 p-5 pt-0">
          <div className="grid gap-3 md:grid-cols-3">
            <Select
              value={workspaceId || undefined}
              onValueChange={(value) => {
                setWorkspaceId(value);
                setRepositoryId('');
                void refresh(value);
              }}
            >
              <SelectTrigger><SelectValue placeholder="工作区" /></SelectTrigger>
              <SelectContent>
                {workspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={repositoryId || undefined} onValueChange={setRepositoryId}>
              <SelectTrigger><SelectValue placeholder="仓库" /></SelectTrigger>
              <SelectContent>
                {repositories.map((repository: Repository) => (
                  <SelectItem key={repository.id} value={repository.id}>{repository.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div
              className={cn(
                'flex h-10 w-full min-w-0 items-center rounded-md border border-input bg-background px-3 text-sm',
                bindingError && !binding && 'border-destructive/50',
              )}
              title={binding?.repositoryUrl}
            >
              {bindingLoading ? (
                <span className="truncate text-muted-foreground">正在解析仓库地址…</span>
              ) : binding ? (
                <span className="truncate text-foreground">
                  {providerLabel(binding.provider)} · {binding.externalPath}
                </span>
              ) : (
                <span className={cn('truncate', bindingError ? 'text-destructive' : 'text-muted-foreground')}>
                  {bindingError || '请选择可识别的 Git 仓库'}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              创建后 FlowX 会自动生成 Secret；你只需复制到 GitLab 的 Secret token，无需先填再回来改。
            </p>
            <Button onClick={() => void createSource()} disabled={!binding || bindingLoading || creating}>
              {creating ? '创建中…' : '创建数据源'}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Sources" title="数据源列表" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {loading ? <Spinner className="h-7 w-7" /> : sources.length > 0 ? (
            <div className="flex flex-col gap-3">
              {sources.map((source) => {
                const showSetup = setupSourceId === source.id;
                return (
                  <div
                    key={source.id}
                    className={cn(
                      'rounded-md border border-border p-4',
                      showSetup && 'border-primary/40 ring-1 ring-primary/20',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{providerLabel(source.provider)}</Badge>
                          <div className="font-semibold text-foreground">{source.externalPath}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={source.isActive ? 'default' : 'outline'}>
                          {source.isActive ? '启用' : '停用'}
                        </Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSetupSourceId(showSetup ? null : source.id)}
                        >
                          {showSetup ? '收起配置说明' : '配置 Webhook'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void toggleSource(source)}>
                          {source.isActive ? '停用' : '启用'}
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => void deleteSource(source)}>
                          删除
                        </Button>
                      </div>
                    </div>
                    {showSetup ? (
                      <WebhookSetupGuide
                        source={source}
                        onRegenerateSecret={() => void regenerateSecret(source)}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="暂无数据源"
              description="选择工作区与仓库后点击「创建数据源」，再按卡片中的步骤配置 GitLab/GitHub webhook。"
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
