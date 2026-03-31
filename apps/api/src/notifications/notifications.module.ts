import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DingTalkNotificationService } from './dingtalk-notification.service';

@Module({
  imports: [PrismaModule],
  providers: [DingTalkNotificationService],
  exports: [DingTalkNotificationService],
})
export class NotificationsModule {}
