import { Typography } from 'antd';

const { Title, Text, Paragraph } = Typography;

interface PageHeroProps {
  eyebrow: string;
  title: string;
  description: string;
}

export function PageHero({ eyebrow, title, description }: PageHeroProps) {
  return (
    <div className="page-hero">
      <Text className="eyebrow">{eyebrow}</Text>
      <Title level={2}>{title}</Title>
      <Paragraph className="page-hero-copy">{description}</Paragraph>
    </div>
  );
}
