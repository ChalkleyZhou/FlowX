import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateOrganizationMemberDto } from './dto/create-organization-member.dto';
import { TransferOrganizationAdminDto } from './dto/transfer-organization-admin.dto';
import { UpdateOrganizationMemberDto } from './dto/update-organization-member.dto';
import { DingTalkCallbackDto } from './dto/dingtalk-callback.dto';
import { DingTalkLoginDto } from './dto/dingtalk-login.dto';
import { ExchangeCodeDto } from './dto/exchange-code.dto';
import { GetAuthorizeUrlDto } from './dto/get-authorize-url.dto';
import { PasswordLoginDto } from './dto/password-login.dto';
import { PasswordRegisterDto } from './dto/password-register.dto';
import { SelectOrganizationDto } from './dto/select-organization.dto';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('providers')
  listProviders() {
    return this.authService.listProviders();
  }

  @Get('organization/members')
  listOrganizationMembers(
    @Req() req: { authSession?: { organization?: { id: string } | null } },
  ) {
    const organizationId = req.authSession?.organization?.id?.trim();
    if (!organizationId) {
      return [];
    }
    return this.authService.listOrganizationMembers(organizationId);
  }

  @Post('organization/members')
  createOrganizationMember(
    @Req() req: AuthRequest,
    @Body() dto: CreateOrganizationMemberDto,
  ) {
    const organizationId = this.requireOrganizationId(req);
    const actingUserId = this.requireActingUserId(req);
    return this.authService.createOrganizationMember(organizationId, actingUserId, dto);
  }

  @Patch('organization/members/:userId')
  updateOrganizationMember(
    @Req() req: AuthRequest,
    @Param('userId') userId: string,
    @Body() dto: UpdateOrganizationMemberDto,
  ) {
    const organizationId = this.requireOrganizationId(req);
    const actingUserId = this.requireActingUserId(req);
    return this.authService.updateOrganizationMember(organizationId, actingUserId, userId, dto);
  }

  @Post('organization/admin/transfer')
  transferOrganizationAdmin(@Req() req: AuthRequest, @Body() dto: TransferOrganizationAdminDto) {
    const organizationId = this.requireOrganizationId(req);
    const actingUserId = this.requireActingUserId(req);
    return this.authService.transferOrganizationAdmin(
      organizationId,
      actingUserId,
      dto.targetUserId,
    );
  }

  @Delete('organization/members/:userId')
  removeOrganizationMember(@Req() req: AuthRequest, @Param('userId') userId: string) {
    const organizationId = this.requireOrganizationId(req);
    const actingUserId = this.requireActingUserId(req);
    return this.authService.removeOrganizationMember(organizationId, userId, actingUserId);
  }

  private requireOrganizationId(req: { authSession?: { organization?: { id: string } | null } }) {
    const organizationId = req.authSession?.organization?.id?.trim();
    if (!organizationId) {
      throw new BadRequestException('No organization selected for the current session.');
    }
    return organizationId;
  }

  private requireActingUserId(req: AuthRequest) {
    const actingUserId = req.authSession?.user?.id?.trim();
    if (!actingUserId) {
      throw new UnauthorizedException('Missing authenticated user.');
    }
    return actingUserId;
  }

  @Public()
  @Get(':provider/authorize-url')
  getAuthorizeUrl(
    @Param('provider') provider: string,
    @Query() query: GetAuthorizeUrlDto,
  ) {
    return this.authService.createAuthorizeUrl(provider, query.redirectUri);
  }

  @Public()
  @Get('dingtalk/login')
  async startDingTalkLogin(
    @Query() query: DingTalkLoginDto,
    @Req() request: any,
    @Res() response: any,
  ) {
    const url = await this.authService.createBrowserLoginUrl('dingtalk', {
      callbackUrl: query.callbackUrl,
      next: query.next,
      backendOrigin: `${request.protocol}://${request.get('host')}`,
    });
    return response.redirect(url);
  }

  @Public()
  @Get('dingtalk/callback')
  async handleDingTalkCallback(
    @Query() query: DingTalkCallbackDto,
    @Req() request: any,
    @Res() response: any,
  ) {
    const url = await this.authService.handleBrowserCallback('dingtalk', {
      code: query.code ?? query.authCode,
      state: query.state,
      callbackUrl: query.callbackUrl,
      next: query.next,
      error: query.error,
      errorDescription: query.error_description,
      backendOrigin: `${request.protocol}://${request.get('host')}`,
    });
    return response.redirect(url);
  }

  @Public()
  @Post(':provider/exchange')
  exchangeCode(
    @Param('provider') provider: string,
    @Body() dto: ExchangeCodeDto,
  ) {
    return this.authService.exchangeCode(provider, dto);
  }

  @Public()
  @Post('organization/select')
  selectOrganization(@Body() dto: SelectOrganizationDto) {
    return this.authService.selectOrganization(dto);
  }

  @Public()
  @Post('password/register')
  registerByPassword(@Body() dto: PasswordRegisterDto) {
    return this.authService.registerByPassword(dto);
  }

  @Public()
  @Post('password/login')
  loginByPassword(@Body() dto: PasswordLoginDto) {
    return this.authService.loginByPassword(dto);
  }

  @Get('session/me')
  getSession(@Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token.');
    }
    return this.authService.getSession(authorization.slice('Bearer '.length));
  }
}

type AuthRequest = {
  authSession?: {
    user?: { id: string };
    organization?: { id: string } | null;
  };
};
