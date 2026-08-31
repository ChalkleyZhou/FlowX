import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { YunxiaoWebhooksController } from '../yunxiao-webhooks/yunxiao-webhooks.controller';
import { YunxiaoWebhooksService } from '../yunxiao-webhooks/yunxiao-webhooks.service';
import { BuiltInPluginRegistry } from './plugin.registry';
import { YunxiaoPlugin } from './yunxiao.plugin';
import { ExternalIntegrationsService } from './external-integrations.service';
import { PluginsController } from './plugins.controller';

@Module({
  imports: [ConfigModule, PrismaModule, NotificationsModule],
  controllers: [PluginsController, YunxiaoWebhooksController],
  providers: [
    BuiltInPluginRegistry,
    ExternalIntegrationsService,
    YunxiaoWebhooksService,
  ],
  exports: [ExternalIntegrationsService],
})
export class PluginsModule implements OnModuleInit {
  constructor(private readonly registry: BuiltInPluginRegistry) {}

  onModuleInit() {
    this.registry.register(YunxiaoPlugin);
  }
}
