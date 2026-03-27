import { Button, Card, Form, Input, Select, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { AppLayout } from '../components/AppLayout';
import type { Issue } from '../types';

const { Title, Text, Paragraph } = Typography;

export function IssueDetailPage() {
  const { issueId = '' } = useParams();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  async function refresh() {
    if (!issueId) {
      return;
    }
    setLoading(true);
    try {
      const nextIssue = await api.getIssue(issueId);
      setIssue(nextIssue);
      form.setFieldsValue({
        title: nextIssue.title,
        description: nextIssue.description,
        status: nextIssue.status,
        priority: nextIssue.priority,
        branchName: nextIssue.branchName ?? '',
        resolution: nextIssue.resolution ?? '',
      });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '加载 Issue 详情失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [issueId]);

  async function submit(values: {
    title: string;
    description: string;
    status: string;
    priority: string;
    branchName?: string;
    resolution?: string;
  }) {
    if (!issueId) {
      return;
    }
    setSaving(true);
    try {
      const nextIssue = await api.updateIssue(issueId, values);
      setIssue(nextIssue);
      form.setFieldsValue({
        title: nextIssue.title,
        description: nextIssue.description,
        status: nextIssue.status,
        priority: nextIssue.priority,
        branchName: nextIssue.branchName ?? '',
        resolution: nextIssue.resolution ?? '',
      });
      messageApi.success('Issue 已更新');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '更新 Issue 失败');
    } finally {
      setSaving(false);
    }
  }

  if (!issueId) {
    return <Navigate to="/issues" replace />;
  }

  return (
    <AppLayout>
      {contextHolder}
      <div className="workflow-detail-stack">
        <Card className="panel workflow-banner" bordered={false} loading={loading}>
          <div className="workflow-banner-copy">
            <Text className="eyebrow">Issue Detail</Text>
            <Title level={3}>{issue?.title ?? 'Issue 详情'}</Title>
            <Paragraph>{issue?.description ?? '查看并维护平台内的 Issue 资产。'}</Paragraph>
            <div className="workspace-meta-row">
              <Tag bordered={false} color="processing">
                {issue?.workspace?.name ?? '未绑定工作区'}
              </Tag>
              <Tag bordered={false}>{issue?.priority ?? 'MEDIUM'}</Tag>
              <Tag bordered={false}>{issue?.status ?? 'OPEN'}</Tag>
            </div>
          </div>
          <div className="workflow-banner-side">
            <Link className="ant-btn ghost-button" to="/issues">
              返回 Issue 列表
            </Link>
            {issue?.workflowRun?.id ? (
              <Link className="ant-btn ghost-button" to={`/workflow-runs/${issue.workflowRun.id}`}>
                查看来源流程
              </Link>
            ) : null}
          </div>
        </Card>

        <div className="workflow-detail-grid">
          <div className="workflow-detail-main">
            <Card className="panel" bordered={false} loading={loading}>
              <div className="panel-heading">
                <Text className="eyebrow">Edit Issue</Text>
                <Title level={4}>编辑 Issue</Title>
              </div>
              <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
                <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
                  <Input size="large" />
                </Form.Item>
                <Form.Item name="description" label="描述" rules={[{ required: true, message: '请输入描述' }]}>
                  <Input.TextArea rows={6} />
                </Form.Item>
                <div className="inline-filter-group">
                  <Form.Item name="status" label="状态" style={{ minWidth: 220, flex: 1 }}>
                    <Select
                      options={[
                        { label: 'OPEN', value: 'OPEN' },
                        { label: 'IN_PROGRESS', value: 'IN_PROGRESS' },
                        { label: 'RESOLVED', value: 'RESOLVED' },
                        { label: 'CLOSED', value: 'CLOSED' },
                        { label: 'WONT_FIX', value: 'WONT_FIX' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="priority" label="优先级" style={{ minWidth: 220, flex: 1 }}>
                    <Select
                      options={[
                        { label: 'LOW', value: 'LOW' },
                        { label: 'MEDIUM', value: 'MEDIUM' },
                        { label: 'HIGH', value: 'HIGH' },
                        { label: 'URGENT', value: 'URGENT' },
                      ]}
                    />
                  </Form.Item>
                </div>
                <Form.Item name="branchName" label="分支">
                  <Input />
                </Form.Item>
                <Form.Item name="resolution" label="处理结论">
                  <Input.TextArea rows={4} />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={saving} className="accent-button">
                  保存变更
                </Button>
              </Form>
            </Card>
          </div>

          <div className="workflow-detail-side">
            <Card className="panel" bordered={false} loading={loading}>
              <div className="panel-heading">
                <Text className="eyebrow">Source</Text>
                <Title level={4}>来源上下文</Title>
              </div>
              <Text className="requirement-criteria">来源需求：{issue?.requirement?.title ?? '未关联需求'}</Text>
              <Text className="requirement-criteria">来源分支：{issue?.branchName ?? '未记录分支'}</Text>
              {issue?.reviewFinding ? (
                <>
                  <div className="workflow-side-tags">
                    <Tag bordered={false} color="processing">
                      {issue.reviewFinding.type}
                    </Tag>
                    <Tag bordered={false}>{issue.reviewFinding.severity}</Tag>
                  </div>
                  <Paragraph className="workflow-side-copy">{issue.reviewFinding.description}</Paragraph>
                </>
              ) : null}
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
