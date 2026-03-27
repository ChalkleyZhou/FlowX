import { Typography } from 'antd';
import type { ReactNode } from 'react';

const { Title, Text, Paragraph } = Typography;

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  extra?: ReactNode;
  className?: string;
}

export function SectionHeader({ eyebrow, title, description, extra, className }: SectionHeaderProps) {
  return (
    <div className={['panel-heading', extra ? 'panel-heading-inline' : '', className].filter(Boolean).join(' ')}>
      <div>
        <Text className="eyebrow">{eyebrow}</Text>
        <Title level={4}>{title}</Title>
        {description ? <Paragraph className="section-header-copy">{description}</Paragraph> : null}
      </div>
      {extra}
    </div>
  );
}
