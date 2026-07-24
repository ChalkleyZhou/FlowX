import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiCredentialsController } from './ai-credentials.controller';
import { AiCredentialsService } from './ai-credentials.service';
import { GitCredentialsController } from './git-credentials.controller';
import { GitCredentialsService } from './git-credentials.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CredentialCryptoService } from './credential-crypto.service';
import { PasswordService } from './password.service';
import { PersonalApiTokenService } from './personal-api-token.service';
import { DingTalkAuthProvider } from './providers/dingtalk.provider';
import { ProviderRegistryService } from './providers/provider-registry.service';

@Module({
  imports: [NotificationsModule],
  controllers: [AuthController, AiCredentialsController, GitCredentialsController],
  providers: [
    AuthService,
    AiCredentialsService,
    GitCredentialsService,
    CredentialCryptoService,
    PasswordService,
    PersonalApiTokenService,
    DingTalkAuthProvider,
    ProviderRegistryService,
  ],
  exports: [AuthService, AiCredentialsService, GitCredentialsService, PersonalApiTokenService],
})
export class AuthModule {}
