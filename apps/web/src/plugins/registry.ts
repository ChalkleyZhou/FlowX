import { PlugZap } from 'lucide-react';
import { YunxiaoIntegrationPage } from '../pages/YunxiaoIntegrationPage';
import type { BuiltInWebPlugin } from './plugin.types';

export const builtInPlugins: BuiltInWebPlugin[] = [
  {
    id: 'yunxiao',
    label: '云效集成',
    path: '/settings/integrations/yunxiao',
    icon: PlugZap,
    component: YunxiaoIntegrationPage,
  },
];
