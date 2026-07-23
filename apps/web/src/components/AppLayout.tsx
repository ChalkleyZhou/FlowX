import { useEffect, useState, type PropsWithChildren } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../api';
import { Button } from './ui/button';
import { FlowXLogo } from './FlowXLogo';
import { ThemeToggle } from './ThemeToggle';
import {
  BookOpen,
  Boxes,
  Bug,
  CalendarRange,
  CircleAlert,
  ClipboardList,
  FolderKanban,
  GitBranch,
  GitPullRequest,
  KeyRound,
  LogOut,
  Settings2,
  Workflow,
  Newspaper,
  RadioTower,
  Send,
  SquareTerminal,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

const primaryItems = [
  { key: '/requirements', label: '需求', icon: ClipboardList },
  { key: '/workflow-runs', label: '工作流', icon: Workflow },
  { key: '/projects', label: '项目', icon: FolderKanban },
  { key: '/briefings', label: '简报', icon: Newspaper },
  { key: '/code-reviews', label: '代码审查', icon: GitPullRequest },
  { key: '/schedule', label: '排期', icon: CalendarRange },
  { key: '/bugs', label: '缺陷', icon: Bug },
  { key: '/issues', label: '问题项', icon: CircleAlert },
  { key: '/workspaces', label: '工作区', icon: Boxes },
] satisfies Array<{ key: string; label: string; icon: LucideIcon }>;

const secondaryItems = [
  { key: '/local-agent', label: '本地 Agent', icon: SquareTerminal },
  { key: '/settings/users', label: '用户管理', icon: Users },
  { key: '/settings/ai-credentials', label: 'AI 凭据', icon: KeyRound },
  { key: '/settings/git-credentials', label: 'Git 凭据', icon: GitBranch },
  { key: '/settings/briefing-sources', label: '简报数据源', icon: RadioTower },
  { key: '/settings/code-review-sources', label: '代码审查数据源', icon: GitPullRequest },
  { key: '/settings/delivery-targets', label: '投递目标', icon: Send },
] satisfies Array<{ key: string; label: string; icon: LucideIcon }>;

export function AppLayout({ children }: PropsWithChildren) {
  const { session, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [showAiCredentialReminder, setShowAiCredentialReminder] = useState(false);
  const [showSecondaryMenu, setShowSecondaryMenu] = useState(false);

  const selectedKey =
    [...primaryItems, ...secondaryItems].find((item) => location.pathname.startsWith(item.key))?.key ?? '/requirements';

  function handleLogout() {
    if (!window.confirm('确认退出登录吗？')) {
      return;
    }
    logout();
    navigate('/login', { replace: true });
  }

  useEffect(() => {
    if (!session?.user?.id) {
      return;
    }

    if (!session.organization?.id) {
      setShowAiCredentialReminder(true);
      return;
    }

    let cancelled = false;

    async function checkAiCredentialStatus() {
      try {
        const [cursorStatus, codexStatus] = await Promise.all([
          api.getCursorCredentialStatus(),
          api.getCodexCredentialStatus(),
        ]);

        if (cancelled) {
          return;
        }

        if (!cursorStatus.configured && !codexStatus.configured) {
          setShowAiCredentialReminder(true);
        }
      } catch {
        // If probe fails (e.g. organization/session mismatch), still remind user to configure.
        if (!cancelled) {
          setShowAiCredentialReminder(true);
        }
      }
    }

    void checkAiCredentialStatus();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, session?.organization?.id]);

  return (
    <>
      <div className="flex min-h-screen items-stretch gap-0 max-xl:flex-col">
        <aside className="sticky top-0 flex h-screen w-[232px] min-w-[232px] flex-col gap-5 overflow-y-auto border-r border-nav-border bg-nav px-3 py-4 text-foreground transition-colors max-xl:static max-xl:h-auto max-xl:w-full max-xl:min-w-0 max-xl:flex-row max-xl:flex-wrap max-xl:overflow-x-hidden">
          <div className="mb-1 flex w-full items-center gap-3 border-b border-nav-border px-2 pb-4 pt-1">
            <FlowXLogo labelClassName="[&>div:first-child]:text-foreground [&>div:last-child]:text-nav-text" />
          </div>
          <nav aria-label="主导航" className="flex flex-col gap-1 pt-0.5 max-xl:w-full max-xl:flex-row max-xl:flex-nowrap max-xl:overflow-x-auto max-xl:pb-1">
            {primaryItems.map((item) => {
              const active = selectedKey === item.key;
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  to={item.key}
                  className={[
                    'flex min-h-10 items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm text-nav-text no-underline transition-colors hover:bg-nav-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 max-xl:shrink-0',
                    active ? 'border-nav-border bg-nav-active font-medium text-foreground' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <Icon aria-hidden="true" className={active ? 'h-4 w-4 text-nav-accent' : 'h-4 w-4'} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <nav aria-label="帮助" className="border-t border-nav-border pt-3 max-xl:w-full max-xl:border-t-0 max-xl:pt-0">
            <Link
              to="/user-manual"
              className={[
                'flex min-h-10 items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm text-nav-text no-underline transition-colors hover:bg-nav-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 max-xl:shrink-0',
                selectedKey === '/user-manual' ? 'border-nav-border bg-nav-active font-medium text-foreground' : '',
              ].filter(Boolean).join(' ')}
            >
              <BookOpen aria-hidden="true" className={selectedKey === '/user-manual' ? 'h-4 w-4 text-nav-accent' : 'h-4 w-4'} />
              <span className="truncate">使用手册</span>
            </Link>
          </nav>
          {session ? (
            <div className="mt-auto border-t border-nav-border pt-3 max-xl:mt-0 max-xl:w-full max-xl:pt-2">
              <div className="flex w-full min-w-0 items-center gap-2.5 rounded-md border border-nav-border bg-nav-hover px-2 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-nav-accent/10 text-xs font-bold text-nav-accent">
                    {session.user.avatarUrl ? (
                      <img src={session.user.avatarUrl} alt={session.user.displayName} className="h-full w-full object-cover" />
                    ) : (
                      session.user.displayName.slice(0, 1)
                    )}
                  </div>
                  <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={session.user.displayName}>
                    {session.user.displayName}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 text-nav-text hover:bg-nav-active hover:text-foreground"
                      title="设置与帮助"
                      aria-label="设置与帮助"
                      onClick={() => setShowSecondaryMenu(true)}
                    >
                      <Settings2 aria-hidden="true" className="h-4 w-4" />
                      <span className="sr-only">设置</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 text-nav-text hover:bg-nav-active hover:text-foreground"
                      title="退出登录"
                      aria-label="退出登录"
                      onClick={handleLogout}
                    >
                      <LogOut aria-hidden="true" className="h-4 w-4" />
                      <span className="sr-only">退出</span>
                    </Button>
                </div>
              </div>
            </div>
          ) : null}
          </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-8 pb-10 pt-8 max-[1440px]:px-6 max-[960px]:gap-5 max-[960px]:px-5 max-[780px]:gap-4 max-[780px]:px-4 max-[780px]:pb-7">{children}</main>
        </div>
      </div>
      <Dialog open={showAiCredentialReminder} onOpenChange={setShowAiCredentialReminder}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>请先配置 AI 凭据</DialogTitle>
            <DialogDescription>
              未检测到当前组织的 Cursor/Codex 凭据，工作流将无法调用模型。请先前往「AI 凭据」页面完成配置。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAiCredentialReminder(false)}
            >
              暂不处理
            </Button>
            <Button
              type="button"
              onClick={() => {
                setShowAiCredentialReminder(false);
                navigate('/settings/ai-credentials');
              }}
            >
              去配置 AI 凭据
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showSecondaryMenu} onOpenChange={setShowSecondaryMenu}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置与帮助</DialogTitle>
            <DialogDescription>管理主题与常用入口。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <ThemeToggle />
            <div className="flex flex-col gap-1.5">
              {secondaryItems.map((item) => (
                <Link
                  key={item.key}
                  to={item.key}
                  onClick={() => setShowSecondaryMenu(false)}
                  className="flex min-h-[38px] items-center rounded-md border border-transparent px-2.5 py-1.5 text-sm text-muted-foreground no-underline transition-colors hover:border-border/90 hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <item.icon aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
