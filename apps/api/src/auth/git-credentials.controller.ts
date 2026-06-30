import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { GitCredentialsService } from './git-credentials.service';
import { UpsertGitCredentialDto } from './dto/upsert-git-credential.dto';

@Controller('auth/git-credentials')
export class GitCredentialsController {
  private readonly logger = new Logger(GitCredentialsController.name);

  constructor(private readonly gitCredentialsService: GitCredentialsService) {}

  @Get('github')
  getGithubCredentialStatus(@Req() req: AuthenticatedRequest) {
    const orgId = this.getOrganizationId(req);
    this.logger.debug(`GET_GITHUB_GIT_STATUS orgId=${orgId}`);
    return this.gitCredentialsService.getGithubCredentialStatus(orgId);
  }

  @Put('github')
  upsertGithubCredential(@Req() req: AuthenticatedRequest, @Body() dto: UpsertGitCredentialDto) {
    const orgId = this.getOrganizationId(req);
    this.logger.debug(`UPSERT_GITHUB_GIT orgId=${orgId}`);
    return this.gitCredentialsService.upsertGithubCredential(orgId, dto.accessToken.trim());
  }

  @Delete('github')
  deleteGithubCredential(@Req() req: AuthenticatedRequest) {
    return this.gitCredentialsService.deleteGithubCredential(this.getOrganizationId(req));
  }

  @Get('gitlab')
  getGitlabCredentialStatus(@Req() req: AuthenticatedRequest) {
    const orgId = this.getOrganizationId(req);
    this.logger.debug(`GET_GITLAB_GIT_STATUS orgId=${orgId}`);
    return this.gitCredentialsService.getGitlabCredentialStatus(orgId);
  }

  @Put('gitlab')
  upsertGitlabCredential(@Req() req: AuthenticatedRequest, @Body() dto: UpsertGitCredentialDto) {
    const orgId = this.getOrganizationId(req);
    this.logger.debug(`UPSERT_GITLAB_GIT orgId=${orgId}`);
    return this.gitCredentialsService.upsertGitlabCredential(orgId, dto.accessToken.trim());
  }

  @Delete('gitlab')
  deleteGitlabCredential(@Req() req: AuthenticatedRequest) {
    return this.gitCredentialsService.deleteGitlabCredential(this.getOrganizationId(req));
  }

  private getOrganizationId(req: AuthenticatedRequest) {
    const userId = req.authSession?.user?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user.');
    }
    const organizationId = req.authSession?.organization?.id?.trim();
    if (!organizationId) {
      throw new BadRequestException('请先加入或选择组织后再管理 Git 凭据。');
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
