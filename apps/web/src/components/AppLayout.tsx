import { Avatar, Button, Layout, Menu, Typography } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { useAuth } from '../auth';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

const items = [
  { key: '/workspaces', label: <Link to="/workspaces">工作区</Link> },
  { key: '/requirements', label: <Link to="/requirements">需求</Link> },
  { key: '/workflow-runs', label: <Link to="/workflow-runs">工作流</Link> },
  { key: '/issues', label: <Link to="/issues">问题项</Link> },
  { key: '/bugs', label: <Link to="/bugs">缺陷</Link> },
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
    <Layout className="app-nav-shell">
      <Sider width={248} className="app-nav-sider" breakpoint="lg" collapsedWidth={0}>
        <div className="app-brand">
          <div className="app-brand-mark">F</div>
          <div>
            <Text className="app-brand-eyebrow">FlowX</Text>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items}
          className="app-nav-menu"
        />
      </Sider>
      <Layout className="app-main-layout">
        <Header className="app-topbar">
          <div />
          {session ? (
            <div className="session-panel app-topbar-session">
              <Avatar src={session.user.avatarUrl}>
                {session.user.displayName.slice(0, 1)}
              </Avatar>
              <div>
                <Text strong>{session.user.displayName}</Text>
                <div>
                  <Text type="secondary">{session.organization?.name ?? '未绑定组织'}</Text>
                </div>
              </div>
              <Button className="ghost-button" onClick={handleLogout}>
                退出
              </Button>
            </div>
          ) : null}
        </Header>
        <Content className="page-container">{children}</Content>
      </Layout>
    </Layout>
  );
}
