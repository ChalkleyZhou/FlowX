import { BadRequestException, Body, Controller, Delete, Get, Put, Req, UnauthorizedException } from '@nestjs/common';
import { AiCredentialsService } from './ai-credentials.service';
import { UpsertCursorCredentialDto } from './dto/upsert-cursor-credential.dto';

@Controller('auth/ai-credentials')
export class AiCredentialsController {
  constructor(private readonly aiCredentialsService: AiCredentialsService) {}

  @Get('cursor')
  getCursorCredentialStatus(@Req() req: AuthenticatedRequest) {
    return this.aiCredentialsService.getCursorCredentialStatus(this.getOrganizationId(req));
  }

  @Put('cursor')
  upsertCursorCredential(@Req() req: AuthenticatedRequest, @Body() dto: UpsertCursorCredentialDto) {
    return this.aiCredentialsService.upsertCursorCredential(this.getOrganizationId(req), dto.apiKey.trim());
  }

  @Delete('cursor')
  deleteCursorCredential(@Req() req: AuthenticatedRequest) {
    return this.aiCredentialsService.deleteCursorCredential(this.getOrganizationId(req));
  }

  @Get('codex')
  getCodexCredentialStatus(@Req() req: AuthenticatedRequest) {
    return this.aiCredentialsService.getCodexCredentialStatus(this.getOrganizationId(req));
  }

  @Put('codex')
  upsertCodexCredential(@Req() req: AuthenticatedRequest, @Body() dto: UpsertCursorCredentialDto) {
    return this.aiCredentialsService.upsertCodexCredential(this.getOrganizationId(req), dto.apiKey.trim());
  }

  @Delete('codex')
  deleteCodexCredential(@Req() req: AuthenticatedRequest) {
    return this.aiCredentialsService.deleteCodexCredential(this.getOrganizationId(req));
  }

  private getOrganizationId(req: AuthenticatedRequest) {
    const userId = req.authSession?.user?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user.');
    }
    const organizationId = req.authSession?.organization?.id?.trim();
    if (!organizationId) {
      throw new BadRequestException('请先加入或选择组织后再管理 AI 凭据。');
    }
    return organizationId;
  }
}

type AuthenticatedRequest = {
  authSession?: {
    user?: {
      id?: string;
    };
    organization?: {
      id?: string;
    } | null;
  };
};
