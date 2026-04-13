import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, toApiUrl } from '../api';
import { cn } from '../lib/utils';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { FlowXLogo } from '../components/FlowXLogo';
import { Input as UiInput } from '../components/ui/input';
import { useToast } from '../components/ui/toast';
import type { AuthOrganization } from '../types';

type LoginMode = 'password' | 'register';

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
      api.setAuthToken(token);
      void (async () => {
        setOauthProcessing(true);
        try {
          const current = await api.getCurrentSession();
          applySession(current);
          toast.success('登录成功');
          navigate(redirectPath, { replace: true });
        } catch (error) {
          const nextError = error instanceof Error ? error.message : '登录失败';
          setErrorText(nextError);
          toast.error(nextError);
        } finally {
          setOauthProcessing(false);
          setSearchParams({}, { replace: true });
        }
      })();
      return;
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
      navigate(redirectPath, { replace: true });
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
      navigate(redirectPath, { replace: true });
    } catch (error) {
      const nextError = error instanceof Error ? error.message : '组织选择失败';
      setErrorText(nextError);
      toast.error(nextError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] px-6 py-8 max-[780px]:px-3 max-[780px]:py-5">
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
              <div key={organization.id} className="flex items-center justify-between gap-4 rounded-[14px] border border-[var(--border)] bg-[var(--surface-muted)] p-[14px]">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{organization.name}</div>
                  <div className="mt-1 overflow-wrap-anywhere text-xs text-[var(--text-tertiary)]">{organization.id}</div>
                </div>
                <Button disabled={submitting} onClick={() => void confirmOrganization(organization.id)}>
                  {submitting ? '处理中...' : '进入组织'}
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <div className="mx-auto grid w-full max-w-[1200px] items-center gap-6 [grid-template-columns:minmax(0,1.1fr)_440px] max-[1280px]:grid-cols-1">
        <section className="rounded-[28px] border border-slate-800 bg-slate-950 p-10 shadow-[var(--shadow-lg)] max-[780px]:p-5">
          <FlowXLogo theme="dark" size="lg" className="mb-6" />
          <Badge className="mb-4" variant="outline">
            FlowX Orchestrator
          </Badge>
          <h1 className="m-0 text-[clamp(38px,5vw,56px)] font-bold leading-[1.02] tracking-[-0.03em] text-slate-50">
            把 AI 研发流程做成可确认、可追踪、可继续的系统
          </h1>
          <p className="mb-0 mt-4 max-w-[680px] text-base leading-[1.7] text-slate-50/80">
            面向标准产品研发团队，把需求拆解、方案确认、执行审查和人工决策放进同一条可中断工作流。
          </p>
          <div className="mt-[22px] flex flex-wrap gap-[10px]">
            <span className="rounded-full bg-white/10 px-3 py-2 text-sm text-slate-50/85">阶段式工作流</span>
            <span className="rounded-full bg-white/10 px-3 py-2 text-sm text-slate-50/85">人机确认节点</span>
            <span className="rounded-full bg-white/10 px-3 py-2 text-sm text-slate-50/85">可替换 AI 执行器</span>
          </div>
          <div className="mt-7 grid gap-[14px] [grid-template-columns:repeat(3,minmax(0,1fr))] max-[1280px]:grid-cols-1">
            <div className="rounded-[var(--radius-md)] border border-white/10 bg-white/5 p-[18px]">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-sky-300">Stage Control</span>
              <h3 className="mt-[10px] text-lg font-bold leading-[1.35] text-slate-50">每个阶段都有输入、输出和确认点</h3>
              <p className="mt-[10px] leading-[1.6] text-slate-50/70">从 Requirement 到 Review，每次推进都基于上一步的确认结果。</p>
            </div>
            <div className="rounded-[var(--radius-md)] border border-white/10 bg-white/5 p-[18px]">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-sky-300">Structured Output</span>
              <h3 className="mt-[10px] text-lg font-bold leading-[1.35] text-slate-50">AI 产出默认结构化沉淀</h3>
              <p className="mt-[10px] leading-[1.6] text-slate-50/70">任务拆解、技术方案、代码执行和审查结果都能复用，不是一次性对话。</p>
            </div>
            <div className="rounded-[var(--radius-md)] border border-white/10 bg-white/5 p-[18px]">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-sky-300">Human In Loop</span>
              <h3 className="mt-[10px] text-lg font-bold leading-[1.35] text-slate-50">关键推进节点永远保留人工决策</h3>
              <p className="mt-[10px] leading-[1.6] text-slate-50/70">确认、驳回、返工、回滚都在流程里，而不是散落在聊天记录中。</p>
            </div>
          </div>
        </section>

        <Card className="w-full rounded-3xl border border-border bg-card shadow-[var(--shadow-lg)]">
          <CardHeader className="mb-[18px] p-6 pb-0">
            <span className="inline-block mb-1.5 text-primary text-xs font-bold tracking-[0.08em] uppercase">认证中心</span>
            <h2 className="mt-[10px] text-2xl font-bold leading-[1.2] text-foreground">进入研发调度台</h2>
            <p className="mt-[10px] text-[var(--text-secondary)] leading-[1.65]">
              账号密码适合日常访问，钉钉登录适合企业身份接入与组织上下文绑定。
            </p>
          </CardHeader>
          <CardContent className="space-y-6 p-5 pt-0">

          {errorText ? (
            <Alert variant="destructive" className="mb-[18px]">
              <AlertTitle>登录失败</AlertTitle>
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-2 gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--surface-muted)] p-1">
            <button
              type="button"
              className={cn(
                'h-10 rounded-[10px] border-0 bg-transparent text-sm font-semibold text-[var(--text-secondary)] transition-[background-color,color,box-shadow] duration-150',
                'hover:text-foreground',
                loginMode === 'password' && 'bg-[var(--surface)] text-foreground shadow-[var(--shadow-sm)]',
              )}
              onClick={() => setLoginMode('password')}
            >
              账号登录
            </button>
            <button
              type="button"
              className={cn(
                'h-10 rounded-[10px] border-0 bg-transparent text-sm font-semibold text-[var(--text-secondary)] transition-[background-color,color,box-shadow] duration-150',
                'hover:text-foreground',
                loginMode === 'register' && 'bg-[var(--surface)] text-foreground shadow-[var(--shadow-sm)]',
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

              <div className="my-[14px] mb-[10px] text-center text-[var(--text-tertiary)]">或使用企业身份登录</div>

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
      </div>
    </div>
  );
}
