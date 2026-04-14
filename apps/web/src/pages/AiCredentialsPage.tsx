import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useToast } from '../components/ui/toast';
import type { CursorCredentialStatus } from '../types';

export function AiCredentialsPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<CursorCredentialStatus | null>(null);

  async function refreshStatus() {
    setLoading(true);
    try {
      const result = await api.getCursorCredentialStatus();
      setStatus(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载 Cursor 凭据状态失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await api.upsertCursorCredential({ apiKey });
      setStatus(next);
      setApiKey('');
      toast.success('已保存你的 Cursor API Key（服务端加密存储）');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 Cursor API Key 失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm('确认删除当前账号的 Cursor API Key 吗？');
    if (!confirmed) {
      return;
    }
    setDeleting(true);
    try {
      const next = await api.deleteCursorCredential();
      setStatus(next);
      toast.success('已删除你的 Cursor API Key');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除 Cursor API Key 失败');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Credentials"
        title="AI 凭据设置"
        description="为当前登录账号配置自己的 Cursor API Key。工作流执行将优先使用你的用户凭据。"
      />
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="space-y-2">
          <p className="text-sm text-muted-foreground">
            当前状态：
            {loading
              ? '加载中...'
              : status?.configured
                ? `已配置（最近更新：${status.updatedAt ?? '未知'}）`
                : '未配置'}
          </p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={(event) => void handleSave(event)}>
            <Input
              type="password"
              placeholder="输入 Cursor API Key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              minLength={10}
              required
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? '保存中...' : '保存/更新'}
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
                {deleting ? '删除中...' : '删除凭据'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
