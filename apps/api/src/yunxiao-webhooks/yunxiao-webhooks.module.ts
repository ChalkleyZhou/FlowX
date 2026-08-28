import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { YunxiaoWebhooksController } from './yunxiao-webhooks.controller';
import { YunxiaoWebhooksService } from './yunxiao-webhooks.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [YunxiaoWebhooksController],
  providers: [YunxiaoWebhooksService],
})
export class YunxiaoWebhooksModule {}
