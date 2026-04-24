import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LocalDevPreviewController } from './local-dev-preview.controller';
import { LocalDevPreviewService } from './local-dev-preview.service';

@Module({
  imports: [PrismaModule],
  controllers: [LocalDevPreviewController],
  providers: [LocalDevPreviewService],
  exports: [LocalDevPreviewService],
})
export class DevPreviewModule {}
