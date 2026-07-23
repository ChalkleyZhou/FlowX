import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, toApiUrl } from '../api';
import { cn } from '../lib/utils';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { FlowXLogo } from '../components/FlowXLogo';
import { Input as UiInput } from '../components/ui/input';
import { useToast } from '../components/ui/toast';
import type { AuthOrganization } from '../types';

type LoginMode = 'password' | 'register';

const handledOAuthCallbacks = new Set<string>();
const pendingOAuthCallbackSessions = new Map<string, Promise<{ session: AuthOrganizationSession }>>();

type AuthOrganizationSession = Awaited<ReturnType<typeof api.getCurrentSession>>;

function readOAuthError(searchParams: URLSearchParams) {
  const error = searchParams.get('error');
  const description = searchParams.get('error_description');
  if (!error && !description) {
    return '';
  }
  return description ?? error ?? '钉钉登录失败';
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session, loading, applySession } = useAuth();
  const [loginMode, setLoginMode] = useState<LoginMode>('password');
  const [submitting, setSubmitting] = useState(false);
  const [oauthProcessing, setOauthProcessing] = useState(false);
  const [organizations, setOrganizations] = useState<AuthOrganization[]>([]);
  const [selectionToken, setSelectionToken] = useState('');
  const [organizationModalOpen, setOrganizationModalOpen] = useState(false);
  const [errorText, setErrorText] = useState(() => readOAuthError(searchParams));
  const [account, setAccount] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const toast = useToast();

  const redirectPath = useMemo(() => {
    const state = location.state as { from?: string } | null;
    return state?.from || '/';
  }, [location.state]);

  useEffect(() => {
    if (!loading && session) {
      navigate(redirectPath, { replace: true });
    }
  }, [loading, navigate, redirectPath, session]);

  useEffect(() => {
    const token = searchParams.get('token');
    const selectionTokenParam = searchParams.get('selectionToken');
    const organizationsParam = searchParams.get('organizations');
    const oauthError = readOAuthError(searchParams);

    if (oauthError) {
      setErrorText(oauthError);
      setSearchParams({}, { replace: true });
      return;
    }

    if (token) {
      const callbackKey = `token:${token}`;
      api.setAuthToken(token);

      if (handledOAuthCallbacks.has(callbackKey)) {
        return;
      }

      let active = true;
      let request = pendingOAuthCallbackSessions.get(callbackKey);

      if (!request) {
        request = api.getCurrentSession().then((session) => ({ session }));
        pendingOAuthCallbackSessions.set(callbackKey, request);
      }

      void (async () => {
        setOauthProcessing(true);
        try {
          const { session: current } = await request;
          pendingOAuthCallbackSessions.delete(callbackKey);

          if (!active || handledOAuthCallbacks.has(callbackKey)) {
            return;
          }

          handledOAuthCallbacks.add(callbackKey);
          applySession(current);
          toast.success('登录成功');
        } catch (error) {
          pendingOAuthCallbackSessions.delete(callbackKey);
          const nextError = error instanceof Error ? error.message : '登录失败';
          setErrorText(nextError);
          toast.error(nextError);
        } finally {
          if (active) {
            setOauthProcessing(false);
            setSearchParams({}, { replace: true });
          }
        }
      })();

      return () => {
        active = false;
      };
    }

    if (selectionTokenParam && organizationsParam) {
      try {
        const parsedOrganizations = JSON.parse(
          decodeURIComponent(organizationsParam),
        ) as AuthOrganization[];
        setSelectionToken(selectionTokenParam);
        setOrganizations(parsedOrganizations);
        setOrganizationModalOpen(true);
        setSearchParams({}, { replace: true });
      } catch {
        setErrorText('组织列表解析失败');
        setSearchParams({}, { replace: true });
      }
    }
  }, [applySession, navigate, redirectPath, searchParams, setSearchParams, toast]);

  async function submitPassword(values: {
    account: string;
    password: string;
    displayName?: string;
  }) {
    setSubmitting(true);
    setErrorText('');
    try {
      const result =
        loginMode === 'password'
          ? await api.loginByPassword({
              account: values.account,
              password: values.password,
            })
          : await api.registerByPassword({
              account: values.account,
              password: values.password,
              displayName: values.displayName,
            });

      applySession(result);
      toast.success(loginMode === 'password' ? '登录成功' : '注册成功');
    } catch (error) {
      const nextError = error instanceof Error ? error.message : '登录失败';
      setErrorText(nextError);
      toast.error(nextError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextAccount = account.trim();
    const nextDisplayName = displayName.trim();

    if (!nextAccount) {
      const nextError = '请输入账号';
      setErrorText(nextError);
      toast.error(nextError);
      return;
    }

    if (!password) {
      const nextError = '请输入密码';
      setErrorText(nextError);
      toast.error(nextError);
      return;
    }

    if (password.length < 8) {
      const nextError = '密码至少 8 位';
      setErrorText(nextError);
      toast.error(nextError);
      return;
    }

    await submitPassword({
      account: nextAccount,
      password,
      displayName: loginMode === 'register' && nextDisplayName ? nextDisplayName : undefined,
    });
  }

  async function loginByDingTalk() {
    setSubmitting(true);
    setErrorText('');
    try {
      const callbackUrl = `${window.location.origin}/login`;
      const loginUrl = new URL(toApiUrl('/auth/dingtalk/login'));
      loginUrl.searchParams.set('callbackUrl', callbackUrl);
      loginUrl.searchParams.set('next', redirectPath);
      window.location.href = loginUrl.toString();
    } catch (error) {
      const nextError = error instanceof Error ? error.message : '无法发起钉钉登录';
      setErrorText(nextError);
      toast.error(nextError);
      setSubmitting(false);
    }
  }

  async function confirmOrganization(organizationId: string) {
    setSubmitting(true);
    setErrorText('');
    try {
      const result = await api.selectOrganization({
        selectionToken,
        organizationId,
      });
      applySession(result);
      setOrganizationModalOpen(false);
      setSelectionToken('');
      setOrganizations([]);
      toast.success('组织选择成功');
    } catch (error) {
      const nextError = error instanceof Error ? error.message : '组织选择失败';
      setErrorText(nextError);
      toast.error(nextError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Dialog
        open={organizationModalOpen}
        onOpenChange={(open) => {
          setOrganizationModalOpen(open);
          if (!open) {
            setSelectionToken('');
            setOrganizations([]);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>选择登录组织</DialogTitle>
            <DialogDescription>钉钉登录成功后，请选择要进入的组织上下文。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-[10px]">
            {organizations.map((organization) => (
              <div key={organization.id} className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted p-3.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{organization.name}</div>
                  <div className="mt-1 overflow-wrap-anywhere text-xs text-muted-foreground">{organization.id}</div>
                </div>
                <Button disabled={submitting} onClick={() => void confirmOrganization(organization.id)}>
                  {submitting ? '处理中...' : '进入组织'}
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <header className="mx-auto flex w-full max-w-[1120px] items-center justify-between border-b border-border px-6 py-6 max-[780px]:px-4 max-[780px]:py-5">
        <FlowXLogo size="md" />
        <span className="hidden text-sm text-muted-foreground sm:block">AI 产研效能平台</span>
      </header>

      <main className="flex min-h-[calc(100vh-89px)] items-start justify-center px-4 pb-16 pt-12 max-[780px]:min-h-0 max-[780px]:px-3 max-[780px]:pb-8 max-[780px]:pt-8">
        <div className="w-full max-w-[440px]">
          <div className="mb-5">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-primary">Workspace access</p>
            <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-foreground">登录 FlowX</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">进入你的 AI 产研效能工作台。</p>
          </div>

          <Card className="w-full rounded-lg border border-border bg-card shadow-md">
            <CardContent className="space-y-6 p-6 max-[420px]:p-5">

          {errorText ? (
            <Alert variant="destructive" className="mb-[18px]">
              <AlertTitle>登录失败</AlertTitle>
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted p-1">
            <button
              type="button"
              className={cn(
                'h-10 rounded-sm border-0 bg-transparent text-sm font-semibold text-muted-foreground transition-[background-color,color,box-shadow] duration-150',
                'hover:text-foreground',
                loginMode === 'password' && 'bg-card text-foreground',
              )}
              onClick={() => setLoginMode('password')}
            >
              账号登录
            </button>
            <button
              type="button"
              className={cn(
                'h-10 rounded-sm border-0 bg-transparent text-sm font-semibold text-muted-foreground transition-[background-color,color,box-shadow] duration-150',
                'hover:text-foreground',
                loginMode === 'register' && 'bg-card text-foreground',
              )}
              onClick={() => setLoginMode('register')}
            >
              注册账号
            </button>
          </div>

          <form className="mt-5 flex flex-col gap-[14px]" onSubmit={(event) => void handlePasswordSubmit(event)}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="login-account">账号</label>
              <UiInput
                id="login-account"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                placeholder="请输入账号"
                autoComplete="username"
              />
            </div>
            {loginMode === 'register' ? (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-foreground" htmlFor="login-display-name">显示名称</label>
                <UiInput
                  id="login-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="用于团队内显示，可选填写"
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="login-password">密码</label>
              <UiInput
                id="login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </div>

            <div className="mt-1.5 flex flex-col gap-3">
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={submitting || oauthProcessing}
              >
                {loginMode === 'password' ? '账号登录' : '注册并登录'}
              </Button>

              <div className="my-[14px] mb-[10px] text-center text-muted-foreground">或使用企业身份登录</div>

              <Button
                type="button"
                size="lg"
                variant="outline"
                className="w-full"
                onClick={() => void loginByDingTalk()}
                disabled={submitting || oauthProcessing}
              >
                使用钉钉登录
              </Button>
            </div>
          </form>
            </CardContent>
          </Card>
          <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">企业用户可使用钉钉身份登录。</p>
        </div>
      </main>
    </div>
  );
}
