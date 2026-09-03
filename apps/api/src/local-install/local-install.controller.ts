import { Controller, Get, Header, Req } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import {
  buildInstallPs1Script,
  buildInstallScript,
  requestPublicOrigin,
  resolveInstallApiBaseUrl,
  type InstallRequestLike,
  type InstallScriptInput,
} from './install-script';

@Controller()
export class LocalInstallController {
  @Public()
  @Get('install.ps1')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Content-Disposition', 'inline')
  installPs1(@Req() req: InstallRequestLike): string {
    return buildInstallPs1Script(this.scriptInput(req));
  }

  @Public()
  @Get('install')
  @Header('Content-Type', 'text/x-shellscript; charset=utf-8')
  @Header('Content-Disposition', 'inline')
  install(@Req() req: InstallRequestLike): string {
    return buildInstallScript(this.scriptInput(req));
  }

  private scriptInput(req: InstallRequestLike): InstallScriptInput {
    const webOrigin = requestPublicOrigin(req);
    return {
      apiBaseUrl: resolveInstallApiBaseUrl({
        env: process.env,
        requestOrigin: webOrigin,
      }),
      webOrigin,
      installUrl: `${webOrigin}/install`,
      installPs1Url: `${webOrigin}/install.ps1`,
    };
  }
}
