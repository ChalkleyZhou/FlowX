import { Button, Card, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';

const { Text } = Typography;

interface StageAction {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  variant?: 'primary' | 'default';
}

interface StageCardProps {
  title: string;
  subtitle: string;
  status?: string;
  statusMessage?: string | null;
  attempt?: number;
  output?: unknown;
  actions?: StageAction[];
}

type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

function getStatusColor(status?: string) {
  switch (status) {
    case 'COMPLETED':
      return 'green';
    case 'WAITING_CONFIRMATION':
      return 'gold';
    case 'RUNNING':
      return 'cyan';
    case 'FAILED':
    case 'REJECTED':
      return 'red';
    default:
      return 'default';
  }
}

function formatStageStatus(status?: string) {
  const map: Record<string, string> = {
    COMPLETED: '已完成',
    WAITING_CONFIRMATION: '待确认',
    RUNNING: '执行中',
    FAILED: '失败',
    REJECTED: '已驳回',
    NOT_STARTED: '未开始',
  };

  return map[status ?? 'NOT_STARTED'] ?? status ?? '未开始';
}

function formatOutputLabel(key: string) {
  const map: Record<string, string> = {
    tasks: '任务列表',
    ambiguities: '待澄清项',
    risks: '风险点',
    summary: '方案摘要',
    implementationPlan: '实施步骤',
    filesToModify: '涉及文件',
    newFiles: '新增文件',
    riskPoints: '风险点',
    patchSummary: '改动摘要',
    changedFiles: '变更文件',
    codeChanges: '代码变更',
    diffArtifacts: '差异产物',
    issues: '问题项',
    bugs: '缺陷',
    missingTests: '缺失测试',
    suggestions: '建议',
    impactScope: '影响范围',
    status: '状态',
    message: '说明',
  };

  return map[key] ?? key;
}

function isRecord(value: unknown): value is Record<string, JsonLike> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderPrimitive(value: JsonLike) {
  return <span className="stage-primitive">{String(value)}</span>;
}

function renderArray(values: JsonLike[]) {
  if (values.length === 0) {
    return <Text type="secondary">暂无内容</Text>;
  }

  const simpleValues = values.every((item) => typeof item !== 'object' || item === null);
  if (simpleValues) {
    return (
      <div className="stage-chip-list">
        {values.map((item, index) => (
          <Tag key={`${String(item)}-${index}`} bordered={false} className="stage-chip">
            {String(item)}
          </Tag>
        ))}
      </div>
    );
  }

  return (
    <div className="stage-group-list">
      {values.map((item, index) => (
        <div key={index} className="stage-group-card">
          {renderStructuredValue(item)}
        </div>
      ))}
    </div>
  );
}

function renderObject(record: Record<string, JsonLike>) {
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return <Text type="secondary">暂无内容</Text>;
  }

  return (
    <div className="stage-structured-grid">
      {entries.map(([key, value]) => (
        <div key={key} className="stage-structured-section">
          <div className="stage-structured-label">{formatOutputLabel(key)}</div>
          <div className="stage-structured-value">{renderStructuredValue(value)}</div>
        </div>
      ))}
    </div>
  );
}

function renderStructuredValue(value: unknown): ReactNode {
  if (value === null || value === undefined) {
    return <Text type="secondary">暂无内容</Text>;
  }

  if (Array.isArray(value)) {
    return renderArray(value as JsonLike[]);
  }

  if (isRecord(value)) {
    return renderObject(value);
  }

  return renderPrimitive(value as JsonLike);
}

export function StageCard(props: StageCardProps) {
  const shouldShowStatusMessage =
    !!props.statusMessage && (props.status === 'RUNNING' || props.status === 'FAILED');

  return (
    <Card
      className="stage-card"
      bordered={false}
      title={
        <div className="stage-card-title">
          <div>
            <Text className="stage-index">{props.title}</Text>
            <div className="stage-subtitle">{props.subtitle}</div>
          </div>
          <Space size={8}>
            {props.attempt ? (
              <Tag className="attempt-pill" bordered={false}>
                第 {props.attempt} 次
              </Tag>
            ) : null}
            <Tag color={getStatusColor(props.status)} bordered={false}>
              {formatStageStatus(props.status)}
            </Tag>
          </Space>
        </div>
      }
    >
      <div className="stage-output-label">阶段产出</div>
      {shouldShowStatusMessage ? (
        <Text type="secondary" className="requirement-criteria">
          {props.statusMessage}
        </Text>
      ) : null}

      <div className="stage-output-panel">
        {props.output ? renderStructuredValue(props.output) : <Text type="secondary">暂无输出</Text>}
      </div>

      <div className="stage-action-row">
        {props.actions && props.actions.length > 0 ? (
          props.actions.map((action) => (
            <Button
              key={action.key}
              type={action.variant === 'primary' ? 'primary' : 'default'}
              danger={action.danger}
              onClick={action.onClick}
              disabled={action.disabled}
              loading={action.loading}
              className={action.variant === 'primary' ? 'accent-button' : 'ghost-button'}
            >
              {action.label}
            </Button>
          ))
        ) : (
          <Text type="secondary">当前阶段暂无可用操作</Text>
        )}
      </div>
    </Card>
  );
}
