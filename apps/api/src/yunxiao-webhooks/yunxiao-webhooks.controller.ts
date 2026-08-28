import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Post,
  Body,
  Param,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { YunxiaoWebhookEventDto } from './dto/yunxiao-webhook-event.dto';
import { YunxiaoWebhooksService } from './yunxiao-webhooks.service';

type AuthRequest = {
  authSession?: {
    user?: { id: string };
    organization?: { id: string } | null;
  };
};

@Controller('yunxiao-webhooks')
export class YunxiaoWebhooksController {
  constructor(private readonly yunxiaoWebhooksService: YunxiaoWebhooksService) {}

  @Get('config')
  getConfig(@Req() request: AuthRequest) {
    const { organizationId, userId } = this.requireAuthContext(request);
    return this.yunxiaoWebhooksService.getOrCreateConfig(organizationId, userId);
  }

  @Post('config/rotate-secret')
  rotateSecret(@Req() request: AuthRequest) {
    const { organizationId, userId } = this.requireAuthContext(request);
    return this.yunxiaoWebhooksService.rotateSecret(organizationId, userId);
  }

  @Get('deliveries')
  listDeliveries(@Req() request: AuthRequest) {
    const { organizationId, userId } = this.requireAuthContext(request);
    return this.yunxiaoWebhooksService.listDeliveries(organizationId, userId);
  }

  @Public()
  @Post(':configId/events')
  receive(
    @Param('configId') configId: string,
    @Headers('x-flowx-webhook-secret') secret: string | undefined,
    @Body() payload: YunxiaoWebhookEventDto,
  ) {
    return this.yunxiaoWebhooksService.receive(configId, secret, payload);
  }

  private requireAuthContext(request: AuthRequest) {
    const userId = request.authSession?.user?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user.');
    }
    const organizationId = request.authSession?.organization?.id?.trim();
    if (!organizationId) {
      throw new BadRequestException('No organization selected for the current session.');
    }
    return { organizationId, userId };
  }
}
