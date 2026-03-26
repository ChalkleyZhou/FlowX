import { Button, Card, Descriptions, Space, Tag, Typography } from 'antd';

const { Paragraph, Text } = Typography;

interface StageCardProps {
  title: string;
  status?: string;
  output?: unknown;
  actions?: Array<{
    key: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }>;
}

export function StageCard(props: StageCardProps) {
  return (
    <Card title={props.title} extra={<Tag>{props.status ?? 'not_started'}</Tag>}>
      <Descriptions column={1} size="small">
        <Descriptions.Item label="Structured Output">
          <Paragraph>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(props.output ?? {}, null, 2)}
            </pre>
          </Paragraph>
        </Descriptions.Item>
      </Descriptions>
      {props.actions && props.actions.length > 0 ? (
        <Space wrap>
          {props.actions.map((action) => (
            <Button
              key={action.key}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </Button>
          ))}
        </Space>
      ) : (
        <Text type="secondary">No available actions</Text>
      )}
    </Card>
  );
}

