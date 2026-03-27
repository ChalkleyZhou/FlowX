import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  List,
  Modal,
  Segmented,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../api';
import type { AuthOrganization } from '../types';

const { Title, Paragraph, Text } = Typography;

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
  const [messageApi, contextHolder] = message.useMessage();

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
          messageApi.success('登录成功');
          navigate(redirectPath, { replace: true });
        } catch (error) {
          const nextError = error instanceof Error ? error.message : '登录失败';
          setErrorText(nextError);
          messageApi.error(nextError);
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
  }, [applySession, messageApi, navigate, redirectPath, searchParams, setSearchParams]);

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
      messageApi.success(loginMode === 'password' ? '登录成功' : '注册成功');
      navigate(redirectPath, { replace: true });
    } catch (error) {
      const nextError = error instanceof Error ? error.message : '登录失败';
      setErrorText(nextError);
      messageApi.error(nextError);
    } finally {
      setSubmitting(false);
    }
  }

  async function loginByDingTalk() {
    setSubmitting(true);
    setErrorText('');
    try {
      const callbackUrl = `${window.location.origin}/login`;
      const loginUrl = new URL('/auth/dingtalk/login', import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000');
      loginUrl.searchParams.set('callbackUrl', callbackUrl);
      loginUrl.searchParams.set('next', redirectPath);
      window.location.href = loginUrl.toString();
    } catch (error) {
      const nextError = error instanceof Error ? error.message : '无法发起钉钉登录';
      setErrorText(nextError);
      messageApi.error(nextError);
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
      messageApi.success('组织选择成功');
      navigate(redirectPath, { replace: true });
    } catch (error) {
      const nextError = error instanceof Error ? error.message : '组织选择失败';
      setErrorText(nextError);
      messageApi.error(nextError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      {contextHolder}
      <Modal
        title="选择登录组织"
        open={organizationModalOpen}
        footer={null}
        onCancel={() => setOrganizationModalOpen(false)}
      >
        <List
          dataSource={organizations}
          renderItem={(organization) => (
            <List.Item
              actions={[
                <Button
                  key={organization.id}
                  type="primary"
                  loading={submitting}
                  onClick={() => void confirmOrganization(organization.id)}
                >
                  进入组织
                </Button>,
              ]}
            >
              <List.Item.Meta title={organization.name} description={organization.id} />
            </List.Item>
          )}
        />
      </Modal>

      <div className="auth-shell">
        <section className="auth-showcase">
          <Tag className="hero-tag auth-showcase-tag" bordered={false}>
            FlowX Orchestrator
          </Tag>
          <Title level={1} className="auth-showcase-title">
            把 AI 研发流程做成可确认、可追踪、可继续的系统
          </Title>
          <Paragraph className="auth-showcase-copy">
            面向标准产品研发团队，把需求拆解、方案确认、执行审查和人工决策放进同一条可中断工作流。
          </Paragraph>
          <div className="auth-pill-row">
            <span className="auth-pill">阶段式工作流</span>
            <span className="auth-pill">人机确认节点</span>
            <span className="auth-pill">可替换 AI 执行器</span>
          </div>
          <div className="auth-feature-grid">
            <div className="auth-feature-card">
              <Text className="auth-feature-label">Stage Control</Text>
              <Title level={4}>每个阶段都有输入、输出和确认点</Title>
              <Paragraph>从 Requirement 到 Review，每次推进都基于上一步的确认结果。</Paragraph>
            </div>
            <div className="auth-feature-card">
              <Text className="auth-feature-label">Structured Output</Text>
              <Title level={4}>AI 产出默认结构化沉淀</Title>
              <Paragraph>任务拆解、技术方案、代码执行和审查结果都能复用，不是一次性对话。</Paragraph>
            </div>
            <div className="auth-feature-card">
              <Text className="auth-feature-label">Human In Loop</Text>
              <Title level={4}>关键推进节点永远保留人工决策</Title>
              <Paragraph>确认、驳回、返工、回滚都在流程里，而不是散落在聊天记录中。</Paragraph>
            </div>
          </div>
        </section>

        <Card className="panel auth-card" bordered={false}>
          <div className="auth-hero">
            <Text className="eyebrow">认证中心</Text>
            <Title level={2}>进入研发调度台</Title>
            <Paragraph>
              账号密码适合日常访问，钉钉登录适合企业身份接入与组织上下文绑定。
            </Paragraph>
          </div>

          {errorText ? (
            <Alert
              className="auth-alert"
              type="error"
              showIcon
              message="登录失败"
              description={errorText}
            />
          ) : null}

          <Segmented
            block
            value={loginMode}
            onChange={(value) => setLoginMode(value as LoginMode)}
            options={[
              { label: '账号登录', value: 'password' },
              { label: '注册账号', value: 'register' },
            ]}
          />

          <Form layout="vertical" onFinish={(values) => void submitPassword(values)} style={{ marginTop: 20 }}>
            <Form.Item name="account" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
              <Input size="large" placeholder="请输入账号" autoComplete="username" />
            </Form.Item>
            {loginMode === 'register' ? (
              <Form.Item name="displayName" label="显示名称">
                <Input size="large" placeholder="用于团队内显示，可选填写" />
              </Form.Item>
            ) : null}
            <Form.Item
              name="password"
              label="密码"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 8, message: '密码至少 8 位' },
              ]}
            >
              <Input.Password size="large" placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>

            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Button
                type="primary"
                size="large"
                htmlType="submit"
                className="accent-button"
                loading={submitting || oauthProcessing}
                block
              >
                {loginMode === 'password' ? '账号登录' : '注册并登录'}
              </Button>

              <div className="login-divider">或使用企业身份登录</div>

              <Button
                size="large"
                className="ghost-button"
                onClick={() => void loginByDingTalk()}
                loading={submitting || oauthProcessing}
                block
              >
                使用钉钉登录
              </Button>
            </Space>
          </Form>
        </Card>
      </div>
    </div>
  );
}
