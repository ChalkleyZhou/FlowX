import { useMemo, useState } from 'react';
import { api } from '../api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { useToast } from './ui/toast';
import type { ExecutionPlan, WorkItem } from '../types';

type Props = {
  workItem: Pick<WorkItem, 'id' | 'executionPlans'>;
  onChanged?: () => void | Promise<void>;
};

export function ExecutionPlanPanel({ workItem, onChanged }: Props) {
  const toast = useToast();
  const plan = useMemo<ExecutionPlan | null>(() => workItem.executionPlans?.[0] ?? null, [workItem.executionPlans]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  if (!plan) return null;
  const currentPlan = plan;

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '执行计划操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function addItem() {
    if (!title.trim()) return;
    await run(
      () => api.addExecutionItem(workItem.id, currentPlan.id, { title: title.trim(), description: description.trim() || undefined }),
      '执行项已加入计划',
    );
    setTitle('');
    setDescription('');
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">执行计划</h2>
          <p className="mt-1 text-sm text-muted-foreground">AI 只提供建议，确认后才会派发到端侧。</p>
        </div>
        <Badge variant={currentPlan.status === 'CONFIRMED' ? 'default' : 'outline'}>{currentPlan.status === 'CONFIRMED' ? '已确认' : '待确认'} · {currentPlan.strategy}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentPlan.items.length ? <div className="space-y-2">{currentPlan.items.map((item) => <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="font-medium">{item.title}</p>{item.description ? <p className="mt-1 text-sm text-muted-foreground">{item.description}</p> : null}<div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">{item.target ? <span>目标端：{item.target}</span> : null}{item.ownerHint ? <span>建议负责人：{item.ownerHint}</span> : null}{item.verification ? <span>验证：{item.verification}</span> : null}</div></div><Badge variant="outline">{item.status}</Badge></div>)}</div> : <p className="text-sm text-muted-foreground">计划中还没有执行项。</p>}
        {currentPlan.status === 'DRAFT' ? <>
          <div className="flex flex-wrap gap-2">
            {currentPlan.strategy === 'AI' && !currentPlan.items.length ? <Button variant="outline" disabled={busy} onClick={() => void run(() => api.generateExecutionPlan(workItem.id, currentPlan.id), 'AI 拆解建议已生成')}>生成 AI 拆解建议</Button> : null}
            {currentPlan.items.length ? <Button disabled={busy} onClick={() => void run(() => api.confirmExecutionPlan(workItem.id, currentPlan.id), '执行计划已确认')}>确认并派发</Button> : null}
          </div>
          <div className="grid gap-2 rounded-md border border-dashed p-3"><Input placeholder="新增执行项标题" value={title} onChange={(event) => setTitle(event.target.value)} /><Textarea placeholder="执行项说明（可选）" value={description} onChange={(event) => setDescription(event.target.value)} /><Button variant="secondary" disabled={busy || !title.trim()} onClick={() => void addItem()}>手动添加执行项</Button></div>
        </> : null}
      </CardContent>
    </Card>
  );
}
