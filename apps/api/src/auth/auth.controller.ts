import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
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
