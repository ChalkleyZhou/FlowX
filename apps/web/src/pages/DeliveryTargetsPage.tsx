import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { DeliveryTargetList } from '../components/DeliveryTargetList';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useToast } from '../components/ui/toast';
import type { DeliveryTarget, OrganizationMember, Project, Workspace } from '../types';

const MANUAL_MEMBER_VALUE = '__manual__';

export function DeliveryTargetsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [targets, setTargets] = useState<DeliveryTarget[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
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

  const usesMemberPicker = type === 'DINGTALK_APP';
  const usesWebhook = type === 'DINGTALK_ROBOT';

  const workspaceProjects = useMemo(
    () => projects.filter((project) => project.workspace.id === workspaceId),
    [projects, workspaceId],
  );

  async function refresh(nextWorkspaceId = workspaceId) {
    if (!nextWorkspaceId) {
      setTargets([]);
      return;
    }
    setTargets(await api.getDeliveryTargets({ workspaceId: nextWorkspaceId }));
  }

  useEffect(() => {
    Promise.all([api.getWorkspaces(), api.getProjects(), api.getOrganizationMembers()])
      .then(async ([workspaceList, projectList, memberList]) => {
        setWorkspaces(workspaceList);
        setProjects(projectList);
        setMembers(memberList);
        const firstWorkspaceId = workspaceList[0]?.id ?? '';
        setWorkspaceId(firstWorkspaceId);
        const firstProjectId =
          projectList.find((project) => project.workspace.id === firstWorkspaceId)?.id ?? '';
        setProjectId(firstProjectId);
        if (firstWorkspaceId) {
          setTargets(await api.getDeliveryTargets({ workspaceId: firstWorkspaceId }));
        }
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载投递目标失败'));
  }, []);

  function handleWorkspaceChange(nextWorkspaceId: string) {
    setWorkspaceId(nextWorkspaceId);
    const nextProjectId =
      projects.find((project) => project.workspace.id === nextWorkspaceId)?.id ?? '';
    setProjectId(nextProjectId);
    void refresh(nextWorkspaceId);
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
      toast.error('请至少启用一个投递用途（简报或 Code Review）');
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
      toast.error('请至少保留一个投递用途（简报或 Code Review）');
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
    if (!window.confirm(`确认删除 ${target.name} 吗？`)) {
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
        description="按项目配置简报的钉钉工作通知与群机器人投递目标；发送时仅投递到对应项目的目标。"
      />
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Create" title="新增投递目标" />
        </CardHeader>
        <CardContent className="grid gap-3 p-5 pt-0 md:grid-cols-2 xl:grid-cols-3">
          <Select value={workspaceId || undefined} onValueChange={handleWorkspaceChange}>
            <SelectTrigger><SelectValue placeholder="工作区" /></SelectTrigger>
            <SelectContent>{workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select
            value={projectId || undefined}
            onValueChange={setProjectId}
            disabled={workspaceProjects.length === 0}
          >
            <SelectTrigger><SelectValue placeholder="项目" /></SelectTrigger>
            <SelectContent>
              {workspaceProjects.map((project) => (
                <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            <Select
              value={selectedMemberId}
              onValueChange={handleMemberChange}
            >
              <SelectTrigger><SelectValue placeholder="组织成员" /></SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.displayName}
                    {member.email ? ` (${member.email})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                aria-label="用于 Code Review"
              />
              用于 Code Review
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
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Targets" title="目标列表" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {workspaceProjects.length === 0 ? (
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
        </CardContent>
      </Card>
    </>
  );
}
