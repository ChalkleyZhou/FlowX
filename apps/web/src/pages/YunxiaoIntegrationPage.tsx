import { useEffect, useState } from 'react';
import { PlugZap, RefreshCw, Save, Trash2, Users } from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useToast } from '../components/ui/toast';
import { useConfirm } from '../components/ConfirmDialog';
import type {
  YunxiaoIntegrationStatus,
  YunxiaoProjectMember,
  YunxiaoUnmatchedRecipient,
} from '../types';

const UNMAPPED_VALUE = '__unmapped__';

function getMemberKey(member: YunxiaoProjectMember) {
  return member.aliyunAccountId ?? member.userId ?? member.memberId ?? member.displayName;
}

export function YunxiaoIntegrationPage() {
  const { session } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<YunxiaoIntegrationStatus | null>(null);
  const [yunxiaoOrganizationIdentifier, setYunxiaoOrganizationIdentifier] = useState('');
  const [unmatchedRecipients, setUnmatchedRecipients] = useState<YunxiaoUnmatchedRecipient[]>([]);
  const [projectId, setProjectId] = useState('');
  const [projectMembers, setProjectMembers] = useState<YunxiaoProjectMember[]>([]);
  const [flowxUserOptions, setFlowxUserOptions] = useState<Array<{
    id: string;
    displayName: string;
    account?: string | null;
    email?: string | null;
  }>>([]);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({});
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearingUnmatched, setClearingUnmatched] = useState(false);
  const isAdmin = session?.organization?.role === 'admin';

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getYunxiaoIntegration(),
      api.getYunxiaoUnmatchedRecipients(),
    ])
      .then(([result, unmatched]) => {
        if (!cancelled) {
          setStatus(result);
          setYunxiaoOrganizationIdentifier(result.yunxiaoOrganizationIdentifier ?? '');
          setUnmatchedRecipients(unmatched);
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

  async function refreshUnmatchedRecipients() {
    try {
      setUnmatchedRecipients(await api.getYunxiaoUnmatchedRecipients());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载未匹配人员失败');
    }
  }

  async function clearUnmatchedRecipients() {
    if (!isAdmin || unmatchedRecipients.length === 0) {
      return;
    }
    const confirmed = await confirm({
      description: '确认清空当前组织全部未匹配人员记录吗？清空后不可恢复。',
      confirmLabel: '清空记录',
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    setClearingUnmatched(true);
    try {
      const result = await api.clearYunxiaoUnmatchedRecipients();
      setUnmatchedRecipients([]);
      toast.success(`已清空 ${result.deletedCount} 条未匹配人员记录`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清空未匹配人员记录失败');
    } finally {
      setClearingUnmatched(false);
    }
  }

  async function loadProjectMembers(nextProjectId = projectId) {
    const normalizedProjectId = nextProjectId.trim();
    if (!normalizedProjectId) {
      toast.error('请填写云效项目 ID');
      return;
    }
    setLoadingMembers(true);
    try {
      const result = await api.getYunxiaoProjectMembers(normalizedProjectId);
      setProjectId(normalizedProjectId);
      setProjectMembers(result.members);
      setFlowxUserOptions(result.flowxUsers);
      setMappingDrafts(Object.fromEntries(
        result.members.map((member) => [getMemberKey(member), member.flowxUserId ?? UNMAPPED_VALUE]),
      ));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载云效项目成员失败');
    } finally {
      setLoadingMembers(false);
    }
  }

  async function saveMemberMapping(member: YunxiaoProjectMember) {
    if (!isAdmin) {
      return;
    }
    setSaving(true);
    try {
      const memberKey = getMemberKey(member);
      const flowxUserId = mappingDrafts[memberKey] === UNMAPPED_VALUE
        ? null
        : mappingDrafts[memberKey] ?? null;
      await api.updateYunxiaoMemberMapping({
        yunxiaoMemberId: member.memberId,
        yunxiaoUserId: member.userId,
        aliyunAccountId: member.aliyunAccountId,
        yunxiaoDisplayName: member.displayName,
        flowxUserId,
      });
      setProjectMembers((current) => current.map((item) => getMemberKey(item) === memberKey
        ? { ...item, flowxUserId }
        : item));
      await refreshUnmatchedRecipients();
      toast.success(flowxUserId ? '云效成员关联已保存' : '云效成员关联已解除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存云效成员关联失败');
    } finally {
      setSaving(false);
    }
  }

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
        description="接收云效工作项通知，并按云效成员 ID 发送钉钉工作通知。"
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
                  <div className="mt-1 font-medium">
                    {status.configured ? 'Webhook Secret 已配置' : 'Webhook Secret 未配置'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {status.openApiConfigured ? '云效 API 已配置' : '云效 API 未配置'}
                  </div>
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
              <div className="space-y-3 border-t border-border pt-5">
                <div>
                  <h3 className="text-sm font-semibold">云效项目成员关联</h3>
                  <p className="text-sm text-muted-foreground">
                    使用个人 Token 只能拿到云效 userId，请先加载项目成员，再手动关联 FlowX 用户。
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    placeholder="输入云效项目 ID，例如 spaceIdentifier"
                    disabled={loadingMembers || saving}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void loadProjectMembers()}
                    disabled={loadingMembers || saving}
                  >
                    <Users size={16} />
                    {loadingMembers ? '加载中...' : '加载成员'}
                  </Button>
                </div>
                {projectMembers.length > 0 ? (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[860px] text-left text-sm">
                      <thead className="bg-muted text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">云效成员</th>
                          <th className="px-3 py-2 font-medium">组织成员 ID</th>
                          <th className="px-3 py-2 font-medium">云效 userId</th>
                          <th className="px-3 py-2 font-medium">阿里云 ID</th>
                          <th className="px-3 py-2 font-medium">角色</th>
                          <th className="px-3 py-2 font-medium">FlowX 用户</th>
                          <th className="px-3 py-2 font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectMembers.map((member) => (
                          <tr key={getMemberKey(member)} className="border-t border-border align-top">
                            <td className="px-3 py-2 font-medium">{member.displayName}</td>
                            <td className="px-3 py-2 font-mono text-xs">{member.memberId ?? '-'}</td>
                            <td className="px-3 py-2 font-mono text-xs">{member.userId ?? '-'}</td>
                            <td className="px-3 py-2 font-mono text-xs">{member.aliyunAccountId ?? '-'}</td>
                            <td className="px-3 py-2">{member.roleName ?? '-'}</td>
                            <td className="w-72 px-3 py-2">
                              <Select
                                value={mappingDrafts[getMemberKey(member)] ?? UNMAPPED_VALUE}
                                onValueChange={(value) => setMappingDrafts((current) => ({
                                  ...current,
                                  [getMemberKey(member)]: value,
                                }))}
                                disabled={saving || !isAdmin}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="未关联" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={UNMAPPED_VALUE}>未关联</SelectItem>
                                  {flowxUserOptions.map((user) => (
                                    <SelectItem key={user.id} value={user.id}>
                                      {user.displayName}{user.account ? `（${user.account}）` : ''}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => void saveMemberMapping(member)}
                                disabled={saving || !isAdmin}
                                title="保存关联"
                              >
                                <Save size={16} />
                                保存
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">输入项目 ID 后加载成员列表。</p>
                )}
              </div>
              <div className="space-y-3 border-t border-border pt-5">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-sm font-semibold">未匹配人员</h3>
                    <p className="text-sm text-muted-foreground">
                      最近 100 条无法通过云效 ID 找到钉钉用户的记录。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void refreshUnmatchedRecipients()}
                    >
                      <RefreshCw size={16} />
                      刷新
                    </Button>
                    {isAdmin ? (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => void clearUnmatchedRecipients()}
                        disabled={clearingUnmatched || unmatchedRecipients.length === 0}
                        title="清空未匹配记录"
                      >
                        <Trash2 size={16} />
                        清空记录
                      </Button>
                    ) : null}
                  </div>
                </div>
                {unmatchedRecipients.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无未匹配人员。</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-muted text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">云效人员</th>
                          <th className="px-3 py-2 font-medium">云效 ID</th>
                          <th className="px-3 py-2 font-medium">角色</th>
                          <th className="px-3 py-2 font-medium">项目</th>
                          <th className="px-3 py-2 font-medium">原因</th>
                          <th className="px-3 py-2 font-medium">最近发现</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unmatchedRecipients.map((recipient) => (
                          <tr key={recipient.id} className="border-t border-border align-top">
                            <td className="px-3 py-2 font-medium">{recipient.yunxiaoDisplayName}</td>
                            <td className="px-3 py-2 font-mono text-xs">{recipient.yunxiaoUserIdentifier ?? '-'}</td>
                            <td className="px-3 py-2">{recipient.roles.join('、')}</td>
                            <td className="px-3 py-2 font-mono text-xs">{recipient.projectId ?? '-'}</td>
                            <td className="px-3 py-2 text-muted-foreground">{recipient.reason ?? recipient.status}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                              {new Date(recipient.lastSeenAt).toLocaleString('zh-CN')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
