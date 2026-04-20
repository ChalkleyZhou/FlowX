import { BadRequestException, Body, Controller, Delete, Get, Logger, Put, Req, UnauthorizedException } from '@nestjs/common';
import { AiCredentialsService } from './ai-credentials.service';
import { UpsertCursorCredentialDto } from './dto/upsert-cursor-credential.dto';

@Controller('auth/ai-credentials')
export class AiCredentialsController {
  private readonly logger = new Logger(AiCredentialsController.name);

  constructor(private readonly aiCredentialsService: AiCredentialsService) {}

  @Get('cursor')
  getCursorCredentialStatus(@Req() req: AuthenticatedRequest) {
    const orgId = this.getOrganizationId(req);
    this.logger.debug(`GET_CURSOR_STATUS orgId=${orgId}`);
    return this.aiCredentialsService.getCursorCredentialStatus(orgId);
  }

  @Put('cursor')
  upsertCursorCredential(@Req() req: AuthenticatedRequest, @Body() dto: UpsertCursorCredentialDto) {
    const orgId = this.getOrganizationId(req);
    this.logger.debug(`UPSERT_CURSOR orgId=${orgId}`);
    return this.aiCredentialsService.upsertCursorCredential(orgId, dto.apiKey.trim());
  }

  @Delete('cursor')
  deleteCursorCredential(@Req() req: AuthenticatedRequest) {
    return this.aiCredentialsService.deleteCursorCredential(this.getOrganizationId(req));
  }

  @Get('codex')
  getCodexCredentialStatus(@Req() req: AuthenticatedRequest) {
    const orgId = this.getOrganizationId(req);
    this.logger.debug(`GET_CODEX_STATUS orgId=${orgId}`);
    return this.aiCredentialsService.getCodexCredentialStatus(orgId);
  }

  @Put('codex')
  upsertCodexCredential(@Req() req: AuthenticatedRequest, @Body() dto: UpsertCursorCredentialDto) {
    const orgId = this.getOrganizationId(req);
    this.logger.debug(`UPSERT_CODEX orgId=${orgId}`);
    return this.aiCredentialsService.upsertCodexCredential(orgId, dto.apiKey.trim());
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
