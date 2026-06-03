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
import type { DeliveryTarget, Workspace } from '../types';

export function DeliveryTargetsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [targets, setTargets] = useState<DeliveryTarget[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [type, setType] = useState('EMAIL');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [secret, setSecret] = useState('');
  const toast = useToast();

  async function refresh(nextWorkspaceId = workspaceId) {
    if (!nextWorkspaceId) {
      return;
    }
    setTargets(await api.getDeliveryTargets({ workspaceId: nextWorkspaceId }));
  }

  useEffect(() => {
    api.getWorkspaces()
      .then(async (workspaceList) => {
        setWorkspaces(workspaceList);
        const first = workspaceList[0]?.id ?? '';
        setWorkspaceId(first);
        if (first) {
          setTargets(await api.getDeliveryTargets({ workspaceId: first }));
        }
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载投递目标失败'));
  }, []);

  async function createTarget() {
    if (!workspaceId || !name || !address) {
      toast.error('请填写完整投递目标');
      return;
    }
    await api.createDeliveryTarget({
      workspaceId,
      type,
      name,
      ...(type === 'EMAIL' ? { emailAddress: address } : { dingtalkWebhookUrl: address, dingtalkSecret: secret }),
    });
    setName('');
    setAddress('');
    setSecret('');
    await refresh(workspaceId);
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
      <PageHeader eyebrow="Delivery" title="投递目标" description="配置项目简报的邮件和钉钉机器人投递目标。" />
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Create" title="新增投递目标" />
        </CardHeader>
        <CardContent className="grid gap-3 p-5 pt-0 md:grid-cols-5">
          <Select value={workspaceId || undefined} onValueChange={(value) => { setWorkspaceId(value); void refresh(value); }}>
            <SelectTrigger><SelectValue placeholder="工作区" /></SelectTrigger>
            <SelectContent>{workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue placeholder="类型" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="EMAIL">邮件</SelectItem>
              <SelectItem value="DINGTALK_ROBOT">钉钉机器人</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="名称" value={name} onChange={(event) => setName(event.target.value)} />
          <Input placeholder={type === 'EMAIL' ? '邮箱地址' : '钉钉机器人 Webhook'} value={address} onChange={(event) => setAddress(event.target.value)} />
          <div className="flex gap-2">
            {type === 'DINGTALK_ROBOT' ? <Input placeholder="签名密钥" value={secret} onChange={(event) => setSecret(event.target.value)} /> : null}
            <Button onClick={createTarget}>保存</Button>
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
                    <div className="text-sm text-muted-foreground">{target.emailAddress ?? target.dingtalkWebhookUrl ?? '-'}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={target.isActive ? 'default' : 'outline'}>{target.type}</Badge>
                    <Button variant="outline" size="sm" onClick={() => void toggleTarget(target)}>{target.isActive ? '停用' : '启用'}</Button>
                    <Button variant="destructive" size="sm" onClick={() => void deleteTarget(target)}>删除</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="暂无投递目标" description="添加邮件或钉钉机器人后即可发送简报。" />}
        </CardContent>
      </Card>
    </>
  );
}

