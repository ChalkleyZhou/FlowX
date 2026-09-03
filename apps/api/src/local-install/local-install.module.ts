import { Module } from '@nestjs/common';
import { LocalInstallController } from './local-install.controller';

@Module({
  controllers: [LocalInstallController],
})
export class LocalInstallModule {}
