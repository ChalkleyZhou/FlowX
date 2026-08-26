import { FormEvent, useEffect, useState } from 'react';
import { CircleHelp, ExternalLink } from 'lucide-react';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { useToast } from '../components/ui/toast';
import type { AiCredentialStatus } from '../types';

export function AiCredentialsPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cursorApiKey, setCursorApiKey] = useState('');
  const [codexApiKey, setCodexApiKey] = useState('');
  const [cursorStatus, setCursorStatus] = useState<AiCredentialStatus | null>(null);
  const [codexStatus, setCodexStatus] = useState<AiCredentialStatus | null>(null);

  async function refreshStatus() {
    setLoading(true);
    try {
      const [nextCursorStatus, nextCodexStatus] = await Promise.all([
        api.getCursorCredentialStatus(),
        api.getCodexCredentialStatus(),
      ]);
      setCursorStatus(nextCursorStatus);
      setCodexStatus(nextCodexStatus);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载 Cursor 凭据状态失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function handleSaveCursor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await api.upsertCursorCredential({ apiKey: cursorApiKey });
      setCursorStatus(next);
      setCursorApiKey('');
      toast.success('已保存组织 Cursor API Key（服务端加密存储）');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 Cursor API Key 失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCursor() {
    const confirmed = window.confirm('确认删除当前组织的 Cursor API Key 吗？');
    if (!confirmed) {
      return;
    }
    setDeleting(true);
    try {
      const next = await api.deleteCursorCredential();
      setCursorStatus(next);
      toast.success('已删除组织 Cursor API Key');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除 Cursor API Key 失败');
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveCodex(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await api.upsertCodexCredential({ apiKey: codexApiKey });
      setCodexStatus(next);
      setCodexApiKey('');
      toast.success('已保存组织 Codex/OpenAI API Key（服务端加密存储）');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 Codex/OpenAI API Key 失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCodex() {
    const confirmed = window.confirm('确认删除当前组织的 Codex/OpenAI API Key 吗？');
    if (!confirmed) {
      return;
    }
    setDeleting(true);
    try {
      const next = await api.deleteCodexCredential();
      setCodexStatus(next);
      toast.success('已删除组织 Codex/OpenAI API Key');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除 Codex/OpenAI API Key 失败');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Credentials"
        title="AI 凭据设置"
        description="为当前组织配置共享的 Cursor 与 Codex 凭据。工作流执行将使用组织级凭据。"
        actions={(
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" variant="outline">
                <CircleHelp className="h-4 w-4" aria-hidden="true" />
                如何获取
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>获取 AI 凭据</DialogTitle>
                <DialogDescription>
                  请从对应服务商的官方账户页面创建 API Key，再回到此页面保存。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5 text-sm">
                <section className="space-y-3">
                  <div>
                    <h3 className="font-semibold text-foreground">Cursor API Key</h3>
                    <p className="mt-1 leading-6 text-muted-foreground">
                      登录 Cursor Dashboard，进入 Integrations，在 User API Keys 中创建并复制 API Key。
                    </p>
                  </div>
                  <Button asChild type="button" size="sm" variant="outline">
                    <a href="https://cursor.com/dashboard?tab=integrations" target="_blank" rel="noopener noreferrer">
                      打开 Cursor Dashboard
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  </Button>
                </section>

                <section className="space-y-3 border-t border-border pt-5">
                  <div>
                    <h3 className="font-semibold text-foreground">Codex / OpenAI API Key</h3>
                    <p className="mt-1 leading-6 text-muted-foreground">
                      登录 OpenAI Platform，在 API Keys 页面创建 Project API Key，并确认对应 Project 有可用 API 额度。这里需要 API Key，不是 ChatGPT 登录密码。
                    </p>
                  </div>
                  <Button asChild type="button" size="sm" variant="outline">
                    <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
                      打开 OpenAI Platform
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  </Button>
                </section>

                <p className="rounded-md border border-border bg-muted p-3 leading-6 text-muted-foreground">
                  保存后，凭据将由 FlowX 服务端加密存储并供当前组织的工作流使用。请勿在聊天、工单或代码仓库中发送 API Key。
                </p>
              </div>
            </DialogContent>
          </Dialog>
        )}
      />
      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="space-y-2">
          <p className="text-sm font-medium text-foreground">Cursor API Key</p>
          <p className="text-sm text-muted-foreground">
            当前状态：
            {loading
              ? '加载中...'
              : cursorStatus?.configured
                ? `已配置（最近更新：${cursorStatus.updatedAt ?? '未知'}）`
                : '未配置'}
          </p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={(event) => void handleSaveCursor(event)}>
            <Input
              type="password"
              placeholder="输入 Cursor API Key"
              value={cursorApiKey}
              onChange={(event) => setCursorApiKey(event.target.value)}
              minLength={10}
              required
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? '保存中...' : '保存/更新'}
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleDeleteCursor()} disabled={deleting}>
                {deleting ? '删除中...' : '删除凭据'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="space-y-2">
          <p className="text-sm font-medium text-foreground">Codex / OpenAI 凭据</p>
          <p className="text-sm text-muted-foreground">
            当前状态：
            {loading
              ? '加载中...'
              : codexStatus?.configured
                ? `已配置（最近更新：${codexStatus.updatedAt ?? '未知'}）`
                : '未配置'}
          </p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={(event) => void handleSaveCodex(event)}>
            <Input
              type="password"
              placeholder="输入 OpenAI API Key（用于 Codex）"
              value={codexApiKey}
              onChange={(event) => setCodexApiKey(event.target.value)}
              minLength={10}
              required
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? '保存中...' : '保存/更新'}
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleDeleteCodex()} disabled={deleting}>
                {deleting ? '删除中...' : '删除凭据'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
