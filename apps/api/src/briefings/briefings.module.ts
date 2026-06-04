import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BriefingSourcesController } from './briefing-sources.controller';
import { BriefingSourcesService } from './briefing-sources.service';
import { BriefingSchedulerService } from './briefing-scheduler.service';
import { BriefingsController } from './briefings.controller';
import { BriefingsService } from './briefings.service';
import { BRIEFING_DELIVERY_SENDERS, DeliveryTargetsService } from './delivery-targets.service';
import { DeliveryTargetsController } from './delivery-targets.controller';
import { sendDingTalkMarkdown, sendEmail } from './delivery-senders';

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule],
  controllers: [BriefingSourcesController, BriefingsController, DeliveryTargetsController],
  providers: [
    BriefingSourcesService,
    BriefingsService,
    DeliveryTargetsService,
    BriefingSchedulerService,
    {
      provide: BRIEFING_DELIVERY_SENDERS,
      useValue: {
        sendDingTalkMarkdown,
        sendEmail,
      },
    },
  ],
  exports: [BriefingsService, BriefingSourcesService, DeliveryTargetsService],
})
export class BriefingsModule {}

