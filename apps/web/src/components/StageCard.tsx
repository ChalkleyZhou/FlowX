import { Button, Card, Space, Tag, Typography } from 'antd';

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

export function StageCard(props: StageCardProps) {
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
      {props.statusMessage ? (
        <Text type="secondary" className="requirement-criteria">
          {props.statusMessage}
        </Text>
      ) : null}
      <pre className="stage-output-box">
        {JSON.stringify(props.output ?? { message: '暂无输出' }, null, 2)}
      </pre>

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
