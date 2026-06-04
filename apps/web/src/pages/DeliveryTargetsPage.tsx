import { useEffect, useState } from 'react';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useToast } from '../components/ui/toast';
import type { DeliveryTarget, OrganizationMember, Workspace } from '../types';

const MANUAL_MEMBER_VALUE = '__manual__';

function deliveryTargetDescription(target: DeliveryTarget) {
  if (target.type === 'EMAIL') {
    return target.emailAddress ?? '-';
  }
  if (target.type === 'DINGTALK_APP') {
    return '钉钉工作通知（个人）';
  }
  return target.dingtalkWebhookUrl ?? '-';
}

function deliveryTargetTypeLabel(type: string) {
  if (type === 'EMAIL') {
    return '邮件';
  }
  if (type === 'DINGTALK_APP') {
    return '钉钉应用';
  }
  if (type === 'DINGTALK_ROBOT') {
    return '钉钉机器人';
  }
  return type;
}

export function DeliveryTargetsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [targets, setTargets] = useState<DeliveryTarget[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [type, setType] = useState('EMAIL');
  const [name, setName] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState(MANUAL_MEMBER_VALUE);
  const [address, setAddress] = useState('');
  const [secret, setSecret] = useState('');
  const [resolvingEmail, setResolvingEmail] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const usesMemberPicker = type === 'EMAIL' || type === 'DINGTALK_APP';
  const requiresMember = type === 'DINGTALK_APP';

  async function refresh(nextWorkspaceId = workspaceId) {
    if (!nextWorkspaceId) {
      return;
    }
    setTargets(await api.getDeliveryTargets({ workspaceId: nextWorkspaceId }));
  }

  useEffect(() => {
    Promise.all([api.getWorkspaces(), api.getOrganizationMembers()])
      .then(async ([workspaceList, memberList]) => {
        setWorkspaces(workspaceList);
        setMembers(memberList);
        const first = workspaceList[0]?.id ?? '';
        setWorkspaceId(first);
        if (first) {
          setTargets(await api.getDeliveryTargets({ workspaceId: first }));
        }
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载投递目标失败'));
  }, []);

  async function handleMemberChange(nextMemberId: string) {
    setSelectedMemberId(nextMemberId);
    if (nextMemberId === MANUAL_MEMBER_VALUE) {
      if (type === 'DINGTALK_APP') {
        setName('');
      }
      return;
    }

    const member = members.find((item) => item.id === nextMemberId);
    if (!member) {
      return;
    }

    setName(member.displayName);

    if (type === 'DINGTALK_APP') {
      setAddress('');
      return;
    }

    if (member.email?.trim()) {
      setAddress(member.email.trim());
      return;
    }

    setResolvingEmail(true);
    try {
      const resolved = await api.resolveOrganizationMemberEmail(nextMemberId);
      setAddress(resolved.email);
      toast.success(
        resolved.source === 'dingtalk' ? '已从钉钉获取邮箱' : '已填入成员邮箱',
      );
    } catch (error) {
      setAddress('');
      toast.error(error instanceof Error ? error.message : '获取成员邮箱失败，请手动输入');
    } finally {
      setResolvingEmail(false);
    }
  }

  function resetFormFields() {
    setName('');
    setAddress('');
    setSecret('');
    setSelectedMemberId(MANUAL_MEMBER_VALUE);
  }

  async function createTarget() {
    if (!workspaceId || !name) {
      toast.error('请填写完整投递目标');
      return;
    }
    if (type === 'EMAIL' && !address && selectedMemberId === MANUAL_MEMBER_VALUE) {
      toast.error('请选择组织成员或填写邮箱地址');
      return;
    }
    if (requiresMember && selectedMemberId === MANUAL_MEMBER_VALUE) {
      toast.error('请选择要接收钉钉工作通知的组织成员');
      return;
    }
    if (type === 'DINGTALK_ROBOT' && !address) {
      toast.error('请填写钉钉机器人 Webhook');
      return;
    }

    setSaving(true);
    try {
      await api.createDeliveryTarget({
        workspaceId,
        type,
        name,
        ...(type === 'EMAIL'
          ? {
              ...(selectedMemberId !== MANUAL_MEMBER_VALUE ? { userId: selectedMemberId } : {}),
              ...(address ? { emailAddress: address } : {}),
            }
          : {}),
        ...(type === 'DINGTALK_APP' && selectedMemberId !== MANUAL_MEMBER_VALUE
          ? { userId: selectedMemberId }
          : {}),
        ...(type === 'DINGTALK_ROBOT'
          ? { dingtalkWebhookUrl: address, dingtalkSecret: secret }
          : {}),
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
        description="配置项目简报的邮件、钉钉工作通知和群机器人投递目标。"
      />
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Create" title="新增投递目标" />
        </CardHeader>
        <CardContent className="grid gap-3 p-5 pt-0 md:grid-cols-2 xl:grid-cols-3">
          <Select value={workspaceId || undefined} onValueChange={(value) => { setWorkspaceId(value); void refresh(value); }}>
            <SelectTrigger><SelectValue placeholder="工作区" /></SelectTrigger>
            <SelectContent>{workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={type} onValueChange={(value) => {
            setType(value);
            resetFormFields();
          }}>
            <SelectTrigger><SelectValue placeholder="类型" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="EMAIL">邮件</SelectItem>
              <SelectItem value="DINGTALK_APP">钉钉应用通知</SelectItem>
              <SelectItem value="DINGTALK_ROBOT">钉钉群机器人</SelectItem>
            </SelectContent>
          </Select>
          {usesMemberPicker ? (
            <Select
              value={selectedMemberId}
              onValueChange={(value) => { void handleMemberChange(value); }}
              disabled={resolvingEmail}
            >
              <SelectTrigger><SelectValue placeholder="组织成员" /></SelectTrigger>
              <SelectContent>
                {!requiresMember ? <SelectItem value={MANUAL_MEMBER_VALUE}>手动输入邮箱</SelectItem> : null}
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
          {type === 'EMAIL' || type === 'DINGTALK_ROBOT' ? (
            <Input
              placeholder={type === 'EMAIL' ? '邮箱地址' : '钉钉机器人 Webhook'}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              disabled={type === 'EMAIL' && resolvingEmail}
            />
          ) : null}
          <div className="flex gap-2 md:col-span-2 xl:col-span-3">
            {type === 'DINGTALK_ROBOT' ? <Input placeholder="签名密钥" value={secret} onChange={(event) => setSecret(event.target.value)} /> : null}
            <Button onClick={() => void createTarget()} disabled={saving || resolvingEmail}>
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
          {targets.length > 0 ? (
            <div className="flex flex-col gap-3">
              {targets.map((target) => (
                <div key={target.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
                  <div>
                    <div className="font-semibold text-foreground">{target.name}</div>
                    <div className="text-sm text-muted-foreground">{deliveryTargetDescription(target)}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={target.isActive ? 'default' : 'outline'}>{deliveryTargetTypeLabel(target.type)}</Badge>
                    <Button variant="outline" size="sm" onClick={() => void toggleTarget(target)}>{target.isActive ? '停用' : '启用'}</Button>
                    <Button variant="destructive" size="sm" onClick={() => void deleteTarget(target)}>删除</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="暂无投递目标" description="添加邮件、钉钉应用通知或群机器人后即可发送简报。" />}
        </CardContent>
      </Card>
    </>
  );
}
