import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useToast } from '../components/ui/toast';
import type { GitCredentialStatus } from '../types';

export function GitCredentialsPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [githubAccessToken, setGithubAccessToken] = useState('');
  const [gitlabAccessToken, setGitlabAccessToken] = useState('');
  const [githubStatus, setGithubStatus] = useState<GitCredentialStatus | null>(null);
  const [gitlabStatus, setGitlabStatus] = useState<GitCredentialStatus | null>(null);

  async function refreshStatus() {
    setLoading(true);
    try {
      const [nextGithubStatus, nextGitlabStatus] = await Promise.all([
        api.getGithubCredentialStatus(),
        api.getGitlabCredentialStatus(),
      ]);
      setGithubStatus(nextGithubStatus);
      setGitlabStatus(nextGitlabStatus);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载 Git 凭据状态失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function handleSaveGithub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await api.upsertGithubCredential({ accessToken: githubAccessToken });
      setGithubStatus(next);
      setGithubAccessToken('');
      toast.success('已保存组织 GitHub Access Token（服务端加密存储）');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 GitHub Access Token 失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteGithub() {
    const confirmed = window.confirm('确认删除当前组织的 GitHub Access Token 吗？');
    if (!confirmed) {
      return;
    }
    setDeleting(true);
    try {
      const next = await api.deleteGithubCredential();
      setGithubStatus(next);
      toast.success('已删除组织 GitHub Access Token');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除 GitHub Access Token 失败');
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveGitlab(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await api.upsertGitlabCredential({ accessToken: gitlabAccessToken });
      setGitlabStatus(next);
      setGitlabAccessToken('');
      toast.success('已保存组织 GitLab Access Token（服务端加密存储）');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 GitLab Access Token 失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteGitlab() {
    const confirmed = window.confirm('确认删除当前组织的 GitLab Access Token 吗？');
    if (!confirmed) {
      return;
    }
    setDeleting(true);
    try {
      const next = await api.deleteGitlabCredential();
      setGitlabStatus(next);
      toast.success('已删除组织 GitLab Access Token');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除 GitLab Access Token 失败');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Credentials"
        title="Git 凭据设置"
        description="为当前组织配置 GitHub / GitLab Access Token，供服务器拉取私有代码仓库。"
      />
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="space-y-2">
          <p className="text-sm font-medium text-foreground">GitHub Access Token</p>
          <p className="text-sm text-muted-foreground">
            当前状态：
            {loading
              ? '加载中...'
              : githubStatus?.configured
                ? `已配置（最近更新：${githubStatus.updatedAt ?? '未知'}）`
                : '未配置'}
          </p>
          <p className="text-sm text-muted-foreground">
            建议使用具备 <code className="text-xs">repo</code> 读权限的 Personal Access Token。SSH 地址会在同步时自动转为 HTTPS。
          </p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={(event) => void handleSaveGithub(event)}>
            <Input
              type="password"
              placeholder="输入 GitHub Access Token"
              value={githubAccessToken}
              onChange={(event) => setGithubAccessToken(event.target.value)}
              minLength={8}
              required
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? '保存中...' : '保存/更新'}
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleDeleteGithub()} disabled={deleting}>
                {deleting ? '删除中...' : '删除凭据'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="space-y-2">
          <p className="text-sm font-medium text-foreground">GitLab Access Token</p>
          <p className="text-sm text-muted-foreground">
            当前状态：
            {loading
              ? '加载中...'
              : gitlabStatus?.configured
                ? `已配置（最近更新：${gitlabStatus.updatedAt ?? '未知'}）`
                : '未配置'}
          </p>
          <p className="text-sm text-muted-foreground">
            建议使用具备 <code className="text-xs">read_repository</code> 权限的 Personal Access Token。
          </p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={(event) => void handleSaveGitlab(event)}>
            <Input
              type="password"
              placeholder="输入 GitLab Access Token"
              value={gitlabAccessToken}
              onChange={(event) => setGitlabAccessToken(event.target.value)}
              minLength={8}
              required
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? '保存中...' : '保存/更新'}
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleDeleteGitlab()} disabled={deleting}>
                {deleting ? '删除中...' : '删除凭据'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
