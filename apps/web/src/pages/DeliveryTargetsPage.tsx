import { useEffect, useState } from 'react';
import { api } from '../api';
import { ListPagination } from '../components/ListPagination';
import { PagedSelect } from '../components/PagedSelect';
import { useQualityPage } from './quality/use-quality-page';
import { DeliveryTargetList } from '../components/DeliveryTargetList';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useToast } from '../components/ui/toast';
import { useConfirm } from '../components/ConfirmDialog';
import type { DeliveryTarget, OrganizationMember, Project, Workspace } from '../types';
import { readStoredListFilters, writeStoredListFilters } from '../utils/list-filter-storage';

const MANUAL_MEMBER_VALUE = '__manual__';

export function DeliveryTargetsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [workspaceId, setWorkspaceId] = useState(() => readStoredListFilters('delivery-targets').workspaceId ?? '');
  const [projectId, setProjectId] = useState('');
  const [type, setType] = useState('DINGTALK_APP');
  const [name, setName] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState(MANUAL_MEMBER_VALUE);
  const [address, setAddress] = useState('');
  const [secret, setSecret] = useState('');
  const [forBriefing, setForBriefing] = useState(true);
  const [forCodeReview, setForCodeReview] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const usesMemberPicker = type === 'DINGTALK_APP';
  const usesWebhook = type === 'DINGTALK_ROBOT';

  const result = useQualityPage(`${workspaceId}:${page}:${query}`, () => api.getDeliveryTargets({ workspaceId, page, pageSize: 20, q: query || undefined }), Boolean(workspaceId), setPage);
  const targets = result.items;
  const workspaceProjects = [...new Map([...projects, ...targets.flatMap(target => target.project ? [target.project] : [])].map(project => [project.id, project])).values()];
  const refresh = (_workspaceId = workspaceId) => result.refresh();
  useEffect(() => {
    let active = true;
    const stored = readStoredListFilters('delivery-targets').workspaceId;
    void (stored ? api.getWorkspace(stored) : api.getWorkspaces({ page: 1, pageSize: 1 }).then(page => page.items[0]))
      .then(workspace => { if (active && workspace) { setWorkspaces([workspace]); setWorkspaceId(workspace.id); } })
      .catch(error => { if (active) toast.error(error instanceof Error ? error.message : '加载工作区失败'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setProjects([]); setProjectId('');
    void api.getProjects({ workspaceId, page: 1, pageSize: 1 }).then(result => { if (active) { setProjects(result.items); setProjectId(result.items[0]?.id ?? ''); } }).catch(error => { if (active) toast.error(error instanceof Error ? error.message : '加载项目失败'); });
    return () => { active = false; };
  }, [workspaceId]);

  function handleWorkspaceChange(nextWorkspaceId: string) {
    setWorkspaceId(nextWorkspaceId);
    writeStoredListFilters('delivery-targets', nextWorkspaceId ? { workspaceId: nextWorkspaceId } : {});
    setPage(1); setProjectId('');
  }

  function handleMemberChange(nextMemberId: string) {
    setSelectedMemberId(nextMemberId);
    if (nextMemberId === MANUAL_MEMBER_VALUE) {
      setName('');
      return;
    }

    const member = members.find((item) => item.id === nextMemberId);
    if (!member) {
      return;
    }

    setName(member.displayName);
    setAddress('');
  }

  function resetFormFields() {
    setName('');
    setAddress('');
    setSecret('');
    setSelectedMemberId(MANUAL_MEMBER_VALUE);
    setForBriefing(true);
    setForCodeReview(true);
  }

  async function createTarget() {
    if (!projectId || !name) {
      toast.error('请选择项目并填写完整投递目标');
      return;
    }
    if (usesMemberPicker && selectedMemberId === MANUAL_MEMBER_VALUE) {
      toast.error('请选择要接收钉钉工作通知的组织成员');
      return;
    }
    if (usesWebhook && !address) {
      toast.error('请填写钉钉机器人 Webhook');
      return;
    }
    if (!forBriefing && !forCodeReview) {
      toast.error('请至少启用一个投递用途（简报或代码审查）');
      return;
    }

    setSaving(true);
    try {
      await api.createDeliveryTarget({
        projectId,
        type,
        name,
        forBriefing,
        forCodeReview,
        ...(usesMemberPicker && selectedMemberId !== MANUAL_MEMBER_VALUE
          ? { userId: selectedMemberId }
          : {}),
        ...(usesWebhook ? { dingtalkWebhookUrl: address, dingtalkSecret: secret } : {}),
      });
      resetFormFields();
      await refresh(workspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存投递目标失败');
    } finally {
      setSaving(false);
    }
  }

  async function toggleTarget(target: DeliveryTarget) {
    await api.updateDeliveryTarget(target.id, { isActive: !target.isActive });
    await refresh(workspaceId);
  }

  async function toggleTargetPurpose(target: DeliveryTarget, purpose: 'forBriefing' | 'forCodeReview') {
    const nextValue = !target[purpose];
    if (!nextValue && !target[purpose === 'forBriefing' ? 'forCodeReview' : 'forBriefing']) {
      toast.error('请至少保留一个投递用途（简报或代码审查）');
      return;
    }
    try {
      await api.updateDeliveryTarget(target.id, { [purpose]: nextValue });
      await refresh(workspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新投递用途失败');
    }
  }

  async function deleteTarget(target: DeliveryTarget) {
    if (!await confirm({
      description: `确认删除 ${target.name} 吗？`,
      destructive: true,
    })) {
      return;
    }
    await api.deleteDeliveryTarget(target.id);
    await refresh(workspaceId);
  }

  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        title="投递目标"
        description="按项目配置简报与代码审查的钉钉工作通知与群机器人投递目标；每个目标可分别开启用于简报、用于代码审查，发送时仅投递到对应项目且启用了该用途的目标。"
      />
      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Create" title="新增投递目标" />
        </CardHeader>
        <CardContent className="grid gap-3 p-5 pt-0 md:grid-cols-2 xl:grid-cols-3">
          <PagedSelect label="工作区" value={workspaceId} selectedLabel={workspaces.find(workspace => workspace.id === workspaceId)?.name} onValueChange={handleWorkspaceChange} loadPage={query => api.getWorkspaces(query)} placeholder="工作区" />
          <PagedSelect label="项目" value={projectId} selectedLabel={projects.find(project => project.id === projectId)?.name} onValueChange={setProjectId} disabled={!workspaceId} scopeKey={workspaceId} loadPage={async query => { const result = await api.getProjects({ ...query, workspaceId }); setProjects(current => [...new Map([...current, ...result.items].map(project => [project.id, project])).values()]); return result; }} placeholder="项目" />
          <Select value={type} onValueChange={(value) => {
            setType(value);
            resetFormFields();
          }}>
            <SelectTrigger><SelectValue placeholder="类型" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="DINGTALK_APP">钉钉工作通知</SelectItem>
              <SelectItem value="DINGTALK_ROBOT">钉钉群机器人</SelectItem>
            </SelectContent>
          </Select>
          {usesMemberPicker ? (
            <PagedSelect label="组织成员" value={selectedMemberId === MANUAL_MEMBER_VALUE ? '' : selectedMemberId} onValueChange={handleMemberChange} loadPage={async query => { const result = await api.getOrganizationMembers({ ...query, status: 'ACTIVE' }); setMembers(current => [...new Map([...current, ...result.items].map(member => [member.id, member])).values()]); return { ...result, items: result.items.map(member => ({ id: member.id, name: member.displayName })) }; }} placeholder="组织成员" />
          ) : null}
          <Input placeholder="名称" value={name} onChange={(event) => setName(event.target.value)} />
          {usesWebhook ? (
            <Input
              placeholder="钉钉机器人 Webhook"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-4 md:col-span-2 xl:col-span-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-primary"
                checked={forBriefing}
                onChange={(event) => setForBriefing(event.target.checked)}
                aria-label="用于简报"
              />
              用于简报
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-primary"
                checked={forCodeReview}
                onChange={(event) => setForCodeReview(event.target.checked)}
                aria-label="用于代码审查"
              />
              用于代码审查
            </label>
          </div>
          <div className="flex gap-2 md:col-span-2 xl:col-span-3">
            {usesWebhook ? <Input placeholder="签名密钥" value={secret} onChange={(event) => setSecret(event.target.value)} /> : null}
            <Button onClick={() => void createTarget()} disabled={saving || !projectId}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Targets" title="目标列表" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <Input aria-label="搜索投递目标" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="搜索投递目标" className="mb-3" />
          {!result.hasLoaded || result.loading ? <p role="status">加载中…</p> : result.error && !workspaceProjects.length ? null : workspaceProjects.length === 0 ? (
            <EmptyState title="暂无项目" description="请先在项目中创建工作区下的项目，再配置投递目标。" />
          ) : (
            <DeliveryTargetList
              projects={workspaceProjects}
              targets={targets}
              onToggleTarget={(target) => void toggleTarget(target)}
              onDeleteTarget={(target) => void deleteTarget(target)}
              onToggleTargetForBriefing={(target) => void toggleTargetPurpose(target, 'forBriefing')}
              onToggleTargetForCodeReview={(target) => void toggleTargetPurpose(target, 'forCodeReview')}
            />
          )}
          {result.error ? <p role="alert">{result.error}<Button onClick={() => void result.refresh()}>重试</Button></p> : null}
          <ListPagination page={page} total={result.total} pageSize={20} loading={result.refreshing} onPageChange={setPage} />
        </CardContent>
      </Card>
    </>
  );
}
