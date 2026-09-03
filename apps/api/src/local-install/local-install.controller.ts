import { Controller, Get, Header, Req } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import {
  buildInstallScript,
  requestPublicOrigin,
  resolveInstallApiBaseUrl,
  type InstallRequestLike,
} from './install-script';

@Controller()
export class LocalInstallController {
  @Public()
  @Get('install')
  @Header('Content-Type', 'text/x-shellscript; charset=utf-8')
  @Header('Content-Disposition', 'inline')
  install(@Req() req: InstallRequestLike): string {
    const webOrigin = requestPublicOrigin(req);
    const apiBaseUrl = resolveInstallApiBaseUrl({
      env: process.env,
      requestOrigin: webOrigin,
    });
    return buildInstallScript({
      apiBaseUrl,
      webOrigin,
      installUrl: `${webOrigin}/install`,
    });
  }
}
