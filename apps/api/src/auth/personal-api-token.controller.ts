import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { CreatePersonalApiTokenDto } from './dto/create-personal-api-token.dto';
import { PersonalApiTokenService } from './personal-api-token.service';

@Controller('auth/personal-api-tokens')
export class PersonalApiTokenController {
  constructor(private readonly tokens: PersonalApiTokenService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    const { userId, organizationId } = this.requireUserAndOrganization(req);
    return this.tokens.listTokens(userId, organizationId);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() body: CreatePersonalApiTokenDto) {
    const { userId, organizationId } = this.requireUserAndOrganization(req);
    return this.tokens.createToken({
      userId,
      organizationId,
      name: body.name,
    });
  }

  @Delete(':id')
  revoke(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const { userId, organizationId } = this.requireUserAndOrganization(req);
    return this.tokens.revokeToken(userId, organizationId, id);
  }

  private requireUserAndOrganization(req: AuthenticatedRequest) {
    const userId = req.authSession?.user?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user.');
    }
    const organizationId = req.authSession?.organization?.id?.trim();
    if (!organizationId) {
      throw new BadRequestException('请先加入或选择组织后再管理 API Token。');
    }
    return { userId, organizationId };
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
