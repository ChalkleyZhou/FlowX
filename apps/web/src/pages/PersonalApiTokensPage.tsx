import { FormEvent, useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useToast } from '../components/ui/toast';
import type { PersonalApiTokenCreated, PersonalApiTokenMeta } from '../types';

export function PersonalApiTokensPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [tokens, setTokens] = useState<PersonalApiTokenMeta[]>([]);
  const [createdToken, setCreatedToken] = useState<PersonalApiTokenCreated | null>(null);

  async function refreshTokens() {
    setLoading(true);
    try {
      const next = await api.listPersonalApiTokens();
      setTokens(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载 API Token 失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshTokens();
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    try {
      const created = await api.createPersonalApiToken({ name: name.trim() });
      setCreatedToken(created);
      setName('');
      await refreshTokens();
      toast.success('已创建 API Token（明文仅显示一次）');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建 API Token 失败');
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      toast.success('已复制到剪贴板');
    } catch {
      toast.error('复制失败，请手动选中复制');
    }
  }

  async function handleRevoke(tokenId: string) {
    const confirmed = window.confirm('确认撤销该 API Token 吗？撤销后本地与 CLI 将立即失效。');
    if (!confirmed) {
      return;
    }
    setRevokingId(tokenId);
    try {
      await api.revokePersonalApiToken(tokenId);
      if (createdToken?.id === tokenId) {
        setCreatedToken(null);
      }
      await refreshTokens();
      toast.success('已撤销 API Token');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '撤销 API Token 失败');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Credentials"
        title="API Token"
        description="创建个人长期 API Token，用于 flowx-local / OpenDesign MCP 鉴权。明文仅在创建时显示一次。"
      />
      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="space-y-2">
          <p className="text-sm font-medium text-foreground">创建 Token</p>
          <p className="text-sm text-muted-foreground">
            Token 与当前登录用户同权，绑定当前组织；可随时在下方列表撤销。
          </p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={(event) => void handleCreate(event)}>
            <Input
              type="text"
              placeholder="名称，例如 laptop / opendesign"
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={1}
              maxLength={80}
              required
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={creating || !name.trim()}>
                {creating ? '创建中...' : '创建 Token'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {createdToken ? (
        <Card className="rounded-md border border-border bg-card">
          <CardHeader className="space-y-2">
            <p className="text-sm font-medium text-foreground">新 Token（仅显示一次）</p>
            <p className="text-sm text-muted-foreground">
              请立即复制并保存到 `~/.flowx/credentials.json` 或 `FLOWX_API_TOKEN`。离开本页后无法再次查看明文。
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="break-all rounded-md border border-border bg-surface-subtle px-3 py-2 font-mono text-sm text-foreground">
              {createdToken.token}
            </div>
            <Button type="button" variant="outline" onClick={() => void handleCopy(createdToken.token)}>
              <Copy className="size-4" />
              复制 Token
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="space-y-2">
          <p className="text-sm font-medium text-foreground">已有 Token</p>
          <p className="text-sm text-muted-foreground">
            {loading ? '加载中...' : tokens.length === 0 ? '暂无有效 Token' : `共 ${tokens.length} 个`}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {tokens.map((token) => (
            <div
              key={token.id}
              className="flex flex-col gap-2 rounded-md border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium text-foreground">{token.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {token.tokenPrefix}…
                </p>
                <p className="text-xs text-muted-foreground">
                  创建于 {token.createdAt}
                  {token.lastUsedAt ? ` · 最近使用 ${token.lastUsedAt}` : ' · 尚未使用'}
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                disabled={revokingId === token.id}
                onClick={() => void handleRevoke(token.id)}
              >
                {revokingId === token.id ? '撤销中...' : '撤销'}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
