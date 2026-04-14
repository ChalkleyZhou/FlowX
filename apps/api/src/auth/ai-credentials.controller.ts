import { Body, Controller, Delete, Get, Put, Req, UnauthorizedException } from '@nestjs/common';
import { AiCredentialsService } from './ai-credentials.service';
import { UpsertCursorCredentialDto } from './dto/upsert-cursor-credential.dto';

@Controller('auth/ai-credentials')
export class AiCredentialsController {
  constructor(private readonly aiCredentialsService: AiCredentialsService) {}

  @Get('cursor')
  getCursorCredentialStatus(@Req() req: AuthenticatedRequest) {
    return this.aiCredentialsService.getCursorCredentialStatus(this.getUserId(req));
  }

  @Put('cursor')
  upsertCursorCredential(@Req() req: AuthenticatedRequest, @Body() dto: UpsertCursorCredentialDto) {
    return this.aiCredentialsService.upsertCursorCredential(this.getUserId(req), dto.apiKey.trim());
  }

  @Delete('cursor')
  deleteCursorCredential(@Req() req: AuthenticatedRequest) {
    return this.aiCredentialsService.deleteCursorCredential(this.getUserId(req));
  }

  @Get('codex')
  getCodexCredentialStatus(@Req() req: AuthenticatedRequest) {
    return this.aiCredentialsService.getCodexCredentialStatus(this.getUserId(req));
  }

  @Put('codex')
  upsertCodexCredential(@Req() req: AuthenticatedRequest, @Body() dto: UpsertCursorCredentialDto) {
    return this.aiCredentialsService.upsertCodexCredential(this.getUserId(req), dto.apiKey.trim());
  }

  @Delete('codex')
  deleteCodexCredential(@Req() req: AuthenticatedRequest) {
    return this.aiCredentialsService.deleteCodexCredential(this.getUserId(req));
  }

  private getUserId(req: AuthenticatedRequest) {
    const userId = req.authSession?.user?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user.');
    }
    return userId;
  }
}

type AuthenticatedRequest = {
  authSession?: {
    user?: {
      id?: string;
    };
  };
};
