import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { LocalLaunchService } from './local-launch.service';

@Controller('local-launch')
export class LocalLaunchController {
  constructor(private readonly localLaunchService: LocalLaunchService) {}

  @Post('redeem')
  @Public()
  redeem(@Body() body: { ticket: string }) {
    if (typeof body?.ticket !== 'string' || body.ticket.trim().length === 0) {
      throw new BadRequestException('ticket is required');
    }
    return this.localLaunchService.redeemTicket(body.ticket);
  }
}
