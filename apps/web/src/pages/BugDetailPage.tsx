import { Button, Card, Form, Input, Select, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { AppLayout } from '../components/AppLayout';
import { ContextCard } from '../components/ContextCard';
import { DetailBanner } from '../components/DetailBanner';
import { SectionHeader } from '../components/SectionHeader';
import { SummaryMetrics } from '../components/SummaryMetrics';
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
      messageApi.error(error instanceof Error ? error.message : '加载缺陷详情失败');
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
      messageApi.success('缺陷已更新');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '更新缺陷失败');
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
        <DetailBanner
          eyebrow="Bug Detail"
          title={bug?.title ?? '缺陷详情'}
          description={bug?.description ?? '查看并维护平台内的缺陷资产。'}
          loading={loading}
          tags={
            <>
              <Tag bordered={false} color="error">
                {bug?.severity ?? 'MEDIUM'}
              </Tag>
              <Tag bordered={false}>{bug?.priority ?? 'MEDIUM'}</Tag>
              <Tag bordered={false}>{bug?.status ?? 'OPEN'}</Tag>
              <Tag bordered={false} color="processing">
                {bug?.workspace?.name ?? '未绑定工作区'}
              </Tag>
            </>
          }
          actions={
            <>
              <Link className="ant-btn ghost-button" to="/bugs">
                返回缺陷列表
              </Link>
              {bug?.workflowRun?.id ? (
                <Link className="ant-btn ghost-button" to={`/workflow-runs/${bug.workflowRun.id}`}>
                  查看来源流程
                </Link>
              ) : null}
            </>
          }
        />

        <SummaryMetrics
          className="detail-summary-grid"
          items={[
            { key: 'status', label: '当前状态', value: bug?.status ?? 'OPEN', helpText: '缺陷当前所处的处理阶段。' },
            { key: 'severity', label: '严重级别', value: bug?.severity ?? 'MEDIUM', helpText: '用于标记影响范围和风险等级。' },
            { key: 'priority', label: '优先级', value: bug?.priority ?? 'MEDIUM', helpText: '用于安排修复顺序与处理节奏。' },
            { key: 'workspace', label: '所属工作区', value: bug?.workspace?.name ?? '未绑定', helpText: '当前缺陷所属的项目空间。' },
          ]}
        />

        <div className="workflow-detail-grid">
          <div className="workflow-detail-main">
            <Card className="panel" bordered={false} loading={loading}>
              <SectionHeader eyebrow="Edit Bug" title="编辑缺陷" />
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
            <ContextCard
              eyebrow="Source"
              title="来源上下文"
              loading={loading}
              metrics={[
                { key: 'requirement', label: '来源需求', value: bug?.requirement?.title ?? '未关联需求' },
                { key: 'branch', label: '来源分支', value: bug?.branchName ?? '未记录分支' },
              ]}
            >
              {bug?.reviewFinding ? (
                <div className="detail-context-block">
                  <div className="workflow-side-tags">
                    <Tag bordered={false} color="processing">
                      {bug.reviewFinding.type}
                    </Tag>
                    <Tag bordered={false}>{bug.reviewFinding.severity}</Tag>
                  </div>
                  <Paragraph className="workflow-side-copy">{bug.reviewFinding.description}</Paragraph>
                </div>
              ) : null}
            </ContextCard>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
