import { Button, Card, Form, Input, Select, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { AppLayout } from '../components/AppLayout';
import type { Bug } from '../types';

const { Title, Text, Paragraph } = Typography;

export function BugDetailPage() {
  const { bugId = '' } = useParams();
  const [bug, setBug] = useState<Bug | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  async function refresh() {
    if (!bugId) {
      return;
    }
    setLoading(true);
    try {
      const nextBug = await api.getBug(bugId);
      setBug(nextBug);
      form.setFieldsValue({
        title: nextBug.title,
        description: nextBug.description,
        status: nextBug.status,
        severity: nextBug.severity,
        priority: nextBug.priority,
        branchName: nextBug.branchName ?? '',
        expectedBehavior: nextBug.expectedBehavior ?? '',
        actualBehavior: nextBug.actualBehavior ?? '',
        reproductionSteps: (nextBug.reproductionSteps ?? []).join('\n'),
        resolution: nextBug.resolution ?? '',
      });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '加载 Bug 详情失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [bugId]);

  async function submit(values: {
    title: string;
    description: string;
    status: string;
    severity: string;
    priority: string;
    branchName?: string;
    expectedBehavior?: string;
    actualBehavior?: string;
    reproductionSteps?: string;
    resolution?: string;
  }) {
    if (!bugId) {
      return;
    }
    setSaving(true);
    try {
      const nextBug = await api.updateBug(bugId, {
        ...values,
        reproductionSteps: values.reproductionSteps
          ? values.reproductionSteps.split('\n').map((item) => item.trim()).filter(Boolean)
          : [],
      });
      setBug(nextBug);
      form.setFieldsValue({
        title: nextBug.title,
        description: nextBug.description,
        status: nextBug.status,
        severity: nextBug.severity,
        priority: nextBug.priority,
        branchName: nextBug.branchName ?? '',
        expectedBehavior: nextBug.expectedBehavior ?? '',
        actualBehavior: nextBug.actualBehavior ?? '',
        reproductionSteps: (nextBug.reproductionSteps ?? []).join('\n'),
        resolution: nextBug.resolution ?? '',
      });
      messageApi.success('Bug 已更新');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '更新 Bug 失败');
    } finally {
      setSaving(false);
    }
  }

  if (!bugId) {
    return <Navigate to="/bugs" replace />;
  }

  return (
    <AppLayout>
      {contextHolder}
      <div className="workflow-detail-stack">
        <Card className="panel workflow-banner" bordered={false} loading={loading}>
          <div className="workflow-banner-copy">
            <Text className="eyebrow">Bug Detail</Text>
            <Title level={3}>{bug?.title ?? 'Bug 详情'}</Title>
            <Paragraph>{bug?.description ?? '查看并维护平台内的 Bug 资产。'}</Paragraph>
            <div className="workspace-meta-row">
              <Tag bordered={false} color="error">
                {bug?.severity ?? 'MEDIUM'}
              </Tag>
              <Tag bordered={false}>{bug?.priority ?? 'MEDIUM'}</Tag>
              <Tag bordered={false}>{bug?.status ?? 'OPEN'}</Tag>
              <Tag bordered={false} color="processing">
                {bug?.workspace?.name ?? '未绑定工作区'}
              </Tag>
            </div>
          </div>
          <div className="workflow-banner-side">
            <Link className="ant-btn ghost-button" to="/bugs">
              返回 Bug 列表
            </Link>
            {bug?.workflowRun?.id ? (
              <Link className="ant-btn ghost-button" to={`/workflow-runs/${bug.workflowRun.id}`}>
                查看来源流程
              </Link>
            ) : null}
          </div>
        </Card>

        <div className="workflow-detail-grid">
          <div className="workflow-detail-main">
            <Card className="panel" bordered={false} loading={loading}>
              <div className="panel-heading">
                <Text className="eyebrow">Edit Bug</Text>
                <Title level={4}>编辑 Bug</Title>
              </div>
              <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
                <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
                  <Input size="large" />
                </Form.Item>
                <Form.Item name="description" label="描述" rules={[{ required: true, message: '请输入描述' }]}>
                  <Input.TextArea rows={5} />
                </Form.Item>
                <div className="inline-filter-group">
                  <Form.Item name="status" label="状态" style={{ minWidth: 220, flex: 1 }}>
                    <Select
                      options={[
                        { label: 'OPEN', value: 'OPEN' },
                        { label: 'CONFIRMED', value: 'CONFIRMED' },
                        { label: 'FIXING', value: 'FIXING' },
                        { label: 'FIXED', value: 'FIXED' },
                        { label: 'VERIFIED', value: 'VERIFIED' },
                        { label: 'CLOSED', value: 'CLOSED' },
                        { label: 'WONT_FIX', value: 'WONT_FIX' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="severity" label="严重级别" style={{ minWidth: 220, flex: 1 }}>
                    <Select
                      options={[
                        { label: 'LOW', value: 'LOW' },
                        { label: 'MEDIUM', value: 'MEDIUM' },
                        { label: 'HIGH', value: 'HIGH' },
                        { label: 'CRITICAL', value: 'CRITICAL' },
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
                <Form.Item name="expectedBehavior" label="预期行为">
                  <Input.TextArea rows={3} />
                </Form.Item>
                <Form.Item name="actualBehavior" label="实际行为">
                  <Input.TextArea rows={3} />
                </Form.Item>
                <Form.Item name="reproductionSteps" label="复现步骤">
                  <Input.TextArea rows={5} placeholder="每行一步" />
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
              <Text className="requirement-criteria">来源需求：{bug?.requirement?.title ?? '未关联需求'}</Text>
              <Text className="requirement-criteria">来源分支：{bug?.branchName ?? '未记录分支'}</Text>
              {bug?.reviewFinding ? (
                <>
                  <div className="workflow-side-tags">
                    <Tag bordered={false} color="processing">
                      {bug.reviewFinding.type}
                    </Tag>
                    <Tag bordered={false}>{bug.reviewFinding.severity}</Tag>
                  </div>
                  <Paragraph className="workflow-side-copy">{bug.reviewFinding.description}</Paragraph>
                </>
              ) : null}
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
