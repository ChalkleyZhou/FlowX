import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { useToast } from './ui/toast';
import type { Project } from '../types';

export function ProjectDeleteDialog({ project, onOpenChange, onDeleted }: { project: Project | null; onOpenChange: (open: boolean) => void; onDeleted: (projectId: string) => void }) {
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  useEffect(() => {
    if (!project) {
      setConfirmation('');
      setError('');
      setDeleting(false);
    }
  }, [project]);

  async function remove() {
    if (!project || deleting || confirmation !== project.name) return;
    setDeleting(true);
    setError('');
    try {
      await api.deleteProject(project.id);
      toast.success('项目已删除');
      onOpenChange(false);
      onDeleted(project.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除项目失败');
    } finally {
      setDeleting(false);
    }
  }

  return <Dialog open={Boolean(project)} onOpenChange={open => { if (!deleting) onOpenChange(open); }}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>永久删除项目“{project?.name}”？</DialogTitle>
        <DialogDescription>将永久删除项目及其版本、工作项、工作流、标签、测试和项目配置。当前有执行中的工作流或本地任务时，删除会被拒绝。</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        <p className="text-destructive">此操作不可恢复。项目当前包含 {project?._count?.workItems ?? 0} 条工作项。</p>
        <label className="grid gap-2" htmlFor="project-delete-confirmation">请输入项目名称确认</label>
        <Input id="project-delete-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={project?.name ?? ''} autoFocus />
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={deleting} onClick={() => onOpenChange(false)}>取消</Button>
        <Button type="button" variant="destructive" disabled={deleting || confirmation !== project?.name} onClick={() => void remove()}>{deleting ? '删除中…' : '永久删除项目'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
