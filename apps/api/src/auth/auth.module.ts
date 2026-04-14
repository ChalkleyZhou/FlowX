import { Module } from '@nestjs/common';
import { AiCredentialsController } from './ai-credentials.controller';
import { AiCredentialsService } from './ai-credentials.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CredentialCryptoService } from './credential-crypto.service';
import { PasswordService } from './password.service';
import { DingTalkAuthProvider } from './providers/dingtalk.provider';
import { ProviderRegistryService } from './providers/provider-registry.service';

@Module({
  controllers: [AuthController, AiCredentialsController],
  providers: [
    AuthService,
    AiCredentialsService,
    CredentialCryptoService,
    PasswordService,
    DingTalkAuthProvider,
    ProviderRegistryService,
  ],
  exports: [AuthService, AiCredentialsService],
})
export class AuthModule {}
