import type { PropsWithChildren } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { FlowXLogo } from './FlowXLogo';
import { ThemeToggle } from './ThemeToggle';

const items = [
  { key: '/workspaces', label: '工作区' },
  { key: '/projects', label: '项目' },
  { key: '/requirements', label: '需求' },
  { key: '/workflow-runs', label: '工作流' },
  { key: '/issues', label: '问题项' },
  { key: '/bugs', label: '缺陷' },
];

export function AppLayout({ children }: PropsWithChildren) {
  const { session, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const selectedKey =
    items.find((item) => location.pathname.startsWith(item.key))?.key ?? '/workspaces';

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-screen items-stretch gap-0 max-xl:flex-col">
      <aside className="sticky top-0 flex h-screen w-[248px] min-w-[248px] flex-col gap-4 border-r border-border bg-gradient-to-b from-card/96 to-surface-subtle/98 px-3.5 py-[18px] transition-colors max-xl:static max-xl:h-auto max-xl:w-full max-xl:min-w-0 max-xl:flex-row max-xl:flex-wrap">
        <div className="mb-4 flex items-center gap-3 border-b border-border/90 px-2.5 pb-3.5 pt-2">
          <FlowXLogo />
        </div>
        <nav className="flex flex-col gap-2 pt-0.5 max-xl:flex-row max-xl:flex-wrap">
          {items.map((item) => {
            const active = selectedKey === item.key;
            return (
              <Link
                key={item.key}
                to={item.key}
                className={[
                  'flex min-h-[46px] items-center justify-between rounded-md border border-transparent px-3.5 py-2.5 text-muted-foreground no-underline transition-colors hover:border-border/90 hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-primary/35 bg-primary-soft/95 font-semibold text-primary shadow-[0_6px_18px_rgba(37,99,235,0.08)]'
                    : '',
                ].filter(Boolean).join(' ')}
              >
                <span>{item.label}</span>
                {active ? <Badge variant="secondary" className="shrink-0">当前</Badge> : null}
              </Link>
            );
          })}
        </nav>
        {session ? (
          <div className="mt-auto border-t border-border/90 pt-3">
            <ThemeToggle />
            <div className="flex w-full min-w-0 flex-col items-stretch gap-3 rounded-lg border border-border bg-surface/78 px-3 py-2.5 shadow-sm backdrop-blur-[10px]">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-[42px] w-[42px] shrink-0 place-items-center overflow-hidden rounded-md bg-primary-soft text-sm font-bold text-primary">
                  {session.user.avatarUrl ? (
                    <img src={session.user.avatarUrl} alt={session.user.displayName} className="h-full w-full object-cover" />
                  ) : (
                    session.user.displayName.slice(0, 1)
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{session.user.displayName}</div>
                  <div className="mt-1">
                    <Badge variant="outline">{session.organization?.name ?? '未绑定组织'}</Badge>
                  </div>
                </div>
              </div>
              <Button variant="outline" className="w-full" onClick={handleLogout}>
                退出
              </Button>
            </div>
          </div>
        ) : null}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto flex w-full min-[1440px]:w-[min(1440px,100%)] flex-col gap-7 px-7 pb-10 pt-6 max-[1440px]:px-6 max-[1440px]:pb-8 max-[960px]:gap-5 max-[960px]:px-5 max-[960px]:pb-7 max-[780px]:gap-4 max-[780px]:px-3.5 max-[780px]:pb-6">{children}</main>
      </div>
    </div>
  );
}
