import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { YunxiaoWebhooksService } from './yunxiao-webhooks.service';

@Controller('yunxiao-webhooks')
export class YunxiaoWebhooksController {
  constructor(private readonly yunxiaoWebhooksService: YunxiaoWebhooksService) {}

  @Public()
  @Post()
  receive(
    @Headers('x-projex-signature') signature: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.yunxiaoWebhooksService.receive(signature, payload);
  }
}
