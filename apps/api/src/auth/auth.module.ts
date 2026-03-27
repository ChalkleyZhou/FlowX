import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { DingTalkAuthProvider } from './providers/dingtalk.provider';
import { ProviderRegistryService } from './providers/provider-registry.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    DingTalkAuthProvider,
    ProviderRegistryService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
