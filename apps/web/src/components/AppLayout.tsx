import type { PropsWithChildren } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

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
    <div className="app-nav-shell">
      <aside className="app-nav-sider">
        <div className="app-brand">
          <div className="app-brand-mark">F</div>
          <div className="min-w-0">
            <div className="app-brand-eyebrow">FlowX</div>
            <div className="text-xs text-slate-500">AI Delivery Workspace</div>
          </div>
        </div>
        <nav className="app-nav-menu">
          {items.map((item) => {
            const active = selectedKey === item.key;
            return (
              <Link key={item.key} to={item.key} className={['app-nav-link', active ? 'app-nav-link-active' : ''].filter(Boolean).join(' ')}>
                <span>{item.label}</span>
                {active ? <Badge variant="secondary" className="app-nav-pill">当前</Badge> : null}
              </Link>
            );
          })}
        </nav>
        {session ? (
          <div className="app-nav-footer">
            <div className="session-panel app-topbar-session">
              <div className="session-panel-header">
                <div className="session-avatar">{session.user.avatarUrl ? <img src={session.user.avatarUrl} alt={session.user.displayName} className="session-avatar-image" /> : session.user.displayName.slice(0, 1)}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-950">{session.user.displayName}</div>
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
      <div className="app-main-layout">
        <main className="page-container">{children}</main>
      </div>
    </div>
  );
}
