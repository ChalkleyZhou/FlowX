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
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-6 py-8 max-[780px]:px-3 max-[780px]:py-5">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-28 top-[-120px] h-[440px] w-[440px] rounded-full bg-cyan-500/12 blur-3xl" />
        <div className="absolute bottom-[-180px] right-[-140px] h-[520px] w-[520px] rounded-full bg-blue-500/12 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(148,163,184,0.08),transparent_48%),radial-gradient(circle_at_80%_70%,rgba(56,189,248,0.07),transparent_46%)]" />
      </div>
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

      <div className="relative mx-auto grid w-full max-w-[1240px] items-center gap-7 [grid-template-columns:minmax(0,1.08fr)_460px] max-[1280px]:grid-cols-1">
        <section className="rounded-[30px] border border-slate-800/80 bg-slate-950/75 p-10 shadow-[0_24px_72px_rgba(15,23,42,0.55)] max-[780px]:order-2 max-[780px]:p-5">
          <FlowXLogo size="lg" className="mb-6" />
          <Badge className="mb-4 border-sky-300/35 bg-sky-500/10 text-sky-200" variant="outline">
            FlowX Platform
          </Badge>
          <h1 className="m-0 text-[clamp(40px,5vw,58px)] font-bold leading-[1.02] tracking-[-0.03em] text-slate-50">
            AI 产研效能平台
          </h1>
          <h2 className="mt-3 text-[clamp(22px,2.6vw,32px)] font-semibold leading-[1.2] tracking-[-0.02em] text-slate-100">
            让需求、研发与审查在同一条可控流程中协同
          </h2>
          <p className="mb-0 mt-5 max-w-[700px] text-base leading-[1.75] text-slate-50/80">
            覆盖从需求构思、方案确认、执行落地到审查闭环的全链路，让每次迭代都有记录、有反馈、可继续推进。
          </p>
          <div className="mt-[22px] flex flex-wrap gap-[10px]">
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-sm text-slate-50/85">全链路产研协同</span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-sm text-slate-50/85">结构化过程资产</span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-sm text-slate-50/85">迭代闭环提效</span>
          </div>
          <div className="mt-8 grid gap-[14px] [grid-template-columns:repeat(3,minmax(0,1fr))] max-[1280px]:grid-cols-1">
            <div className="rounded-[var(--radius-md)] border border-white/12 bg-white/5 p-[18px]">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-sky-300">End-to-End Collaboration</span>
              <h3 className="mt-[10px] text-lg font-bold leading-[1.35] text-slate-50">全链路产研协同</h3>
              <p className="mt-[10px] leading-[1.6] text-slate-50/72">需求、方案、执行、审查、问题项在同一流程中连续流转。</p>
            </div>
            <div className="rounded-[var(--radius-md)] border border-white/12 bg-white/5 p-[18px]">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-sky-300">Structured Assets</span>
              <h3 className="mt-[10px] text-lg font-bold leading-[1.35] text-slate-50">结构化过程资产</h3>
              <p className="mt-[10px] leading-[1.6] text-slate-50/72">任务拆解、技术方案、执行结果与评审结论可沉淀、可复用。</p>
            </div>
            <div className="rounded-[var(--radius-md)] border border-white/12 bg-white/5 p-[18px]">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-sky-300">Iteration Loop</span>
              <h3 className="mt-[10px] text-lg font-bold leading-[1.35] text-slate-50">迭代闭环提效</h3>
              <p className="mt-[10px] leading-[1.6] text-slate-50/72">问题项与缺陷可回流到下一轮研发，持续优化交付质量。</p>
            </div>
          </div>
          <p className="mt-6 text-sm leading-[1.65] text-slate-300/75">
            面向团队协作场景设计，支持持续迭代与审查闭环。
          </p>
        </section>

        <Card className="w-full rounded-3xl border border-white/15 bg-slate-900/70 shadow-[0_28px_80px_rgba(15,23,42,0.52)] backdrop-blur-xl max-[780px]:order-1">
          <CardHeader className="mb-[18px] p-6 pb-0">
            <span className="inline-block mb-1.5 text-sky-400 text-xs font-bold tracking-[0.08em] uppercase">认证中心</span>
            <h2 className="mt-[10px] text-[30px] font-bold leading-[1.15] tracking-[-0.02em] text-slate-50">进入 AI 产研效能平台</h2>
            <p className="mt-[10px] text-slate-300/90 leading-[1.7]">
              使用账号或企业身份登录，进入统一的产研协作与迭代闭环工作台。
            </p>
          </CardHeader>
          <CardContent className="space-y-6 p-5 pt-0">

          {errorText ? (
            <Alert variant="destructive" className="mb-[18px]">
              <AlertTitle>登录失败</AlertTitle>
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-2 gap-2 rounded-[14px] border border-white/15 bg-slate-800/70 p-1">
            <button
              type="button"
              className={cn(
                'h-10 rounded-[10px] border-0 bg-transparent text-sm font-semibold text-slate-300 transition-[background-color,color,box-shadow] duration-150',
                'hover:text-slate-100',
                loginMode === 'password' && 'bg-slate-700/80 text-slate-100 shadow-[0_8px_20px_rgba(15,23,42,0.35)]',
              )}
              onClick={() => setLoginMode('password')}
            >
              账号登录
            </button>
            <button
              type="button"
              className={cn(
                'h-10 rounded-[10px] border-0 bg-transparent text-sm font-semibold text-slate-300 transition-[background-color,color,box-shadow] duration-150',
                'hover:text-slate-100',
                loginMode === 'register' && 'bg-slate-700/80 text-slate-100 shadow-[0_8px_20px_rgba(15,23,42,0.35)]',
              )}
              onClick={() => setLoginMode('register')}
            >
              注册账号
            </button>
          </div>

          <form className="mt-5 flex flex-col gap-[14px]" onSubmit={(event) => void handlePasswordSubmit(event)}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-100" htmlFor="login-account">账号</label>
              <UiInput
                id="login-account"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                placeholder="请输入账号"
                autoComplete="username"
                className="border-white/15 bg-slate-900/70 text-slate-100 placeholder:text-slate-400 focus-visible:ring-sky-400/65"
              />
            </div>
            {loginMode === 'register' ? (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-100" htmlFor="login-display-name">显示名称</label>
                <UiInput
                  id="login-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="用于团队内显示，可选填写"
                  className="border-white/15 bg-slate-900/70 text-slate-100 placeholder:text-slate-400 focus-visible:ring-sky-400/65"
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-100" htmlFor="login-password">密码</label>
              <UiInput
                id="login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
                className="border-white/15 bg-slate-900/70 text-slate-100 placeholder:text-slate-400 focus-visible:ring-sky-400/65"
              />
            </div>

            <div className="mt-1.5 flex flex-col gap-3">
              <Button
                type="submit"
                size="lg"
                className="w-full bg-sky-500 text-slate-950 hover:bg-sky-400"
                disabled={submitting || oauthProcessing}
              >
                {loginMode === 'password' ? '账号登录' : '注册并登录'}
              </Button>

              <div className="my-[14px] mb-[10px] text-center text-slate-400">或使用企业身份登录</div>

              <Button
                type="button"
                size="lg"
                variant="outline"
                className="w-full border-white/20 bg-transparent text-slate-100 hover:bg-white/10 hover:text-slate-50"
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
