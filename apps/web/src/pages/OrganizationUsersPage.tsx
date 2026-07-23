import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState } from '../components/EmptyState';
import { ListToolbar } from '../components/ListToolbar';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { RecordListItem } from '../components/RecordListItem';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import type { OrganizationMember } from '../types';

type MemberDraft = {
  account: string;
  password: string;
  displayName: string;
};

const emptyDraft: MemberDraft = {
  account: '',
  password: '',
  displayName: '',
};

function roleLabel(role?: string) {
  return role === 'admin' ? '管理员' : '成员';
}

function statusLabel(status?: string) {
  return status === 'DISABLED' ? '已停用' : '正常';
}

export function OrganizationUsersPage() {
  const { session, refreshSession } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editMember, setEditMember] = useState<OrganizationMember | null>(null);
  const [createDraft, setCreateDraft] = useState<MemberDraft>(emptyDraft);
  const [editDraft, setEditDraft] = useState({
    displayName: '',
    status: 'ACTIVE' as 'ACTIVE' | 'DISABLED',
  });
  const [saving, setSaving] = useState(false);

  const organizationName = session?.organization?.name ?? '当前组织';
  const isAdmin = session?.organization?.role === 'admin';

  const filteredMembers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return members;
    }
    return members.filter((member) => {
      const haystack = [
        member.displayName,
        member.account,
        member.email,
        member.role,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [members, search]);

  const summary = useMemo(
    () => ({
      total: members.length,
      visible: filteredMembers.length,
      adminCount: members.filter((member) => member.role === 'admin').length,
      activeCount: members.filter((member) => member.status !== 'DISABLED').length,
    }),
    [filteredMembers.length, members],
  );

  async function refresh() {
    if (!session?.organization?.id) {
      setMembers([]);
      return;
    }

    setLoading(true);
    try {
      const next = await api.getOrganizationMembers();
      setMembers(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载组织成员失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [session?.organization?.id]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createDraft.account.trim()) {
      toast.error('请填写登录账号');
      return;
    }
    setSaving(true);
    try {
      await api.createOrganizationMember({
        account: createDraft.account.trim(),
        password: createDraft.password.trim() || undefined,
        displayName: createDraft.displayName.trim() || undefined,
      });
      setCreateOpen(false);
      setCreateDraft(emptyDraft);
      await refresh();
      toast.success('成员已添加到当前组织');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加成员失败');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(member: OrganizationMember) {
    setEditMember(member);
    setEditDraft({
      displayName: member.displayName,
      status: member.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    });
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editMember) {
      return;
    }

    setSaving(true);
    try {
      await api.updateOrganizationMember(editMember.id, {
        displayName: editDraft.displayName.trim() || undefined,
        status: editDraft.status,
      });
      setEditMember(null);
      await refresh();
      toast.success('成员信息已更新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新成员失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleTransfer(member: OrganizationMember) {
    const confirmed = window.confirm(
      `确认将组织管理员转让给「${member.displayName}」吗？转让后你将变为普通成员。`,
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    try {
      await api.transferOrganizationAdmin({ targetUserId: member.id });
      await refresh();
      await refreshSession();
      toast.success(`已将管理员转让给「${member.displayName}」`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '转让管理员失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(member: OrganizationMember) {
    const confirmed = window.confirm(`确认将「${member.displayName}」移出组织「${organizationName}」吗？`);
    if (!confirmed) {
      return;
    }

    setSaving(true);
    try {
      await api.removeOrganizationMember(member.id);
      await refresh();
      toast.success('成员已从当前组织移除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移除成员失败');
    } finally {
      setSaving(false);
    }
  }

  if (!session?.organization?.id) {
    return (
      <>
        <PageHeader
          eyebrow="Settings"
          title="用户管理"
          description="管理当前组织内的成员账号与权限。"
        />
        <Card className="rounded-md border border-border bg-card">
          <CardContent className="p-5">
            <EmptyState
              title="未选择组织"
              description="请先在登录后选择组织，再管理该组织下的用户。"
            />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="用户管理"
        description={
          isAdmin
            ? `管理组织「${organizationName}」成员。首个加入组织的用户会自动成为管理员，管理员可转让权限。`
            : `查看组织「${organizationName}」成员。成员管理需由管理员操作。`
        }
      />

      <div className="grid gap-5 md:grid-cols-4">
        <MetricCard label="成员总数" value={summary.total} />
        <MetricCard label="当前筛选结果" value={summary.visible} />
        <MetricCard label="管理员" value={summary.adminCount} />
        <MetricCard label="正常账号" value={summary.activeCount} />
      </div>

      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <SectionHeader
            eyebrow="Organization"
            title="成员列表"
            description={`仅展示组织「${organizationName}」内的成员，数据与其他组织隔离。`}
            extra={
              isAdmin ? (
                <Button type="button" onClick={() => setCreateOpen(true)}>
                  添加成员
                </Button>
              ) : null
            }
          />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <ListToolbar
            search={(
              <Input
                placeholder="搜索姓名、账号或邮箱"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            )}
          />

          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : filteredMembers.length > 0 ? (
            <div className="flex flex-col gap-3.5">
              {filteredMembers.map((member) => {
                const isSelf = member.id === session.user.id;
                const canTransfer =
                  isAdmin && !isSelf && member.role !== 'admin' && member.status !== 'DISABLED';

                return (
                  <RecordListItem
                    key={member.id}
                    className="shadow-none"
                    title={(
                      <div className="text-base font-semibold leading-6 text-foreground">
                        {member.displayName}
                      </div>
                    )}
                    badges={(
                      <>
                        <Badge variant={member.role === 'admin' ? 'default' : 'outline'}>
                          {roleLabel(member.role)}
                        </Badge>
                        <Badge variant={member.status === 'DISABLED' ? 'destructive' : 'secondary'}>
                          {statusLabel(member.status)}
                        </Badge>
                        {isSelf ? <Badge variant="outline">当前用户</Badge> : null}
                      </>
                    )}
                    description={(
                      <p className="text-sm leading-6 text-muted-foreground">
                        {member.account
                          ? `账号：${member.account}`
                          : member.email
                            ? `邮箱：${member.email}`
                            : `用户 ID：${member.id}`}
                      </p>
                    )}
                    details={
                      member.joinedAt ? (
                        <span className="text-xs text-muted-foreground">
                          加入时间：{new Date(member.joinedAt).toLocaleString()}
                        </span>
                      ) : null
                    }
                    actions={
                      isAdmin ? (
                        <>
                          <Button type="button" variant="outline" size="sm" onClick={() => openEdit(member)}>
                            编辑
                          </Button>
                          {canTransfer ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={saving}
                              onClick={() => void handleTransfer(member)}
                            >
                              转让管理员
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={isSelf || saving}
                            onClick={() => void handleRemove(member)}
                          >
                            移出组织
                          </Button>
                        </>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          ) : (
            <EmptyState
              description={
                members.length === 0
                  ? '当前组织还没有成员。首个登录该组织的用户会自动成为管理员。'
                  : '没有匹配的成员，请调整搜索关键词。'
              }
            />
          )}
        </CardContent>
      </Card>

      {isAdmin ? (
        <>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>添加组织成员</DialogTitle>
                <DialogDescription>
                  新建账号会自动加入「{organizationName}」并成为普通成员。若账号已存在，将直接加入当前组织。
                </DialogDescription>
              </DialogHeader>
              <form className="flex flex-col gap-4" onSubmit={handleCreate}>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground" htmlFor="member-account">
                    登录账号
                  </label>
                  <Input
                    id="member-account"
                    value={createDraft.account}
                    onChange={(event) => setCreateDraft((draft) => ({ ...draft, account: event.target.value }))}
                    autoComplete="username"
                    placeholder="例如：zhangsan"
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground" htmlFor="member-password">
                    初始密码
                  </label>
                  <Input
                    id="member-password"
                    type="password"
                    value={createDraft.password}
                    onChange={(event) => setCreateDraft((draft) => ({ ...draft, password: event.target.value }))}
                    autoComplete="new-password"
                    placeholder="新建账号时必填"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground" htmlFor="member-display-name">
                    显示名称
                  </label>
                  <Input
                    id="member-display-name"
                    value={createDraft.displayName}
                    onChange={(event) =>
                      setCreateDraft((draft) => ({ ...draft, displayName: event.target.value }))
                    }
                    placeholder="可选"
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                    取消
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? '保存中…' : '添加'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={Boolean(editMember)} onOpenChange={(open) => !open && setEditMember(null)}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>编辑成员</DialogTitle>
                <DialogDescription>
                  调整成员在「{organizationName}」内的显示名称与账号状态。管理员权限请使用「转让管理员」。
                </DialogDescription>
              </DialogHeader>
              <form className="flex flex-col gap-4" onSubmit={handleUpdate}>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground" htmlFor="edit-display-name">
                    显示名称
                  </label>
                  <Input
                    id="edit-display-name"
                    value={editDraft.displayName}
                    onChange={(event) => setEditDraft((draft) => ({ ...draft, displayName: event.target.value }))}
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground" htmlFor="edit-status">
                    账号状态
                  </label>
                  <Select
                    value={editDraft.status}
                    onValueChange={(value: 'ACTIVE' | 'DISABLED') =>
                      setEditDraft((draft) => ({ ...draft, status: value }))
                    }
                  >
                    <SelectTrigger id="edit-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">正常</SelectItem>
                      <SelectItem value="DISABLED">已停用</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setEditMember(null)}>
                    取消
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? '保存中…' : '保存'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </>
  );
}
