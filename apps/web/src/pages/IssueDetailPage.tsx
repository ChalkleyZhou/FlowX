import { Button, Card, Form, Input, Select, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { AppLayout } from '../components/AppLayout';
import { ContextCard } from '../components/ContextCard';
import { DetailBanner } from '../components/DetailBanner';
import { SectionHeader } from '../components/SectionHeader';
import { SummaryMetrics } from '../components/SummaryMetrics';
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
      messageApi.error(error instanceof Error ? error.message : '加载问题项详情失败');
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
      messageApi.success('问题项已更新');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '更新问题项失败');
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
        <DetailBanner
          eyebrow="Issue Detail"
          title={issue?.title ?? '问题项详情'}
          description={issue?.description ?? '查看并维护平台内的问题项资产。'}
          loading={loading}
          tags={
            <>
              <Tag bordered={false} color="processing">
                {issue?.workspace?.name ?? '未绑定工作区'}
              </Tag>
              <Tag bordered={false}>{issue?.priority ?? 'MEDIUM'}</Tag>
              <Tag bordered={false}>{issue?.status ?? 'OPEN'}</Tag>
            </>
          }
          actions={
            <>
              <Link className="ant-btn ghost-button" to="/issues">
                返回问题项列表
              </Link>
              {issue?.workflowRun?.id ? (
                <Link className="ant-btn ghost-button" to={`/workflow-runs/${issue.workflowRun.id}`}>
                  查看来源流程
                </Link>
              ) : null}
            </>
          }
        />

        <SummaryMetrics
          className="detail-summary-grid"
          items={[
            { key: 'status', label: '当前状态', value: issue?.status ?? 'OPEN', helpText: '问题项当前所处的处理阶段。' },
            { key: 'priority', label: '优先级', value: issue?.priority ?? 'MEDIUM', helpText: '用于标记后续处理和排期的紧急程度。' },
            { key: 'workspace', label: '所属工作区', value: issue?.workspace?.name ?? '未绑定', helpText: '当前问题项所属的项目空间。' },
            {
              key: 'workflow',
              label: '来源流程',
              value: issue?.workflowRun ? '已关联' : '未关联',
              helpText: issue?.workflowRun ? '可追溯到原始工作流与审查上下文。' : '当前未记录来源工作流。',
            },
          ]}
        />

        <div className="workflow-detail-grid">
          <div className="workflow-detail-main">
            <Card className="panel" bordered={false} loading={loading}>
              <SectionHeader eyebrow="Edit Issue" title="编辑问题项" />
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
            <ContextCard
              eyebrow="Source"
              title="来源上下文"
              loading={loading}
              metrics={[
                { key: 'requirement', label: '来源需求', value: issue?.requirement?.title ?? '未关联需求' },
                { key: 'branch', label: '来源分支', value: issue?.branchName ?? '未记录分支' },
              ]}
            >
              {issue?.reviewFinding ? (
                <div className="detail-context-block">
                  <div className="workflow-side-tags">
                    <Tag bordered={false} color="processing">
                      {issue.reviewFinding.type}
                    </Tag>
                    <Tag bordered={false}>{issue.reviewFinding.severity}</Tag>
                  </div>
                  <Paragraph className="workflow-side-copy">{issue.reviewFinding.description}</Paragraph>
                </div>
              ) : null}
            </ContextCard>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
