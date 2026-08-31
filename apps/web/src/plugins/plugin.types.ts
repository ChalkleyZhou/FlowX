import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface BuiltInWebPlugin {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  component: ComponentType;
}
