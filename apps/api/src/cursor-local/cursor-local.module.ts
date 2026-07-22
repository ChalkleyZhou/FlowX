import { Module } from '@nestjs/common';
import { EdgeModule } from '../edge/edge.module';
import { CursorLocalController } from './cursor-local.controller';
import { CursorLocalService } from './cursor-local.service';

@Module({
  imports: [EdgeModule],
  controllers: [CursorLocalController],
  providers: [CursorLocalService],
})
export class CursorLocalModule {}
