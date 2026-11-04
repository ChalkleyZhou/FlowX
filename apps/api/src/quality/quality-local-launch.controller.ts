import { BadRequestException, Body, Controller, Param, Post, Req } from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Public } from '../auth/public.decorator';
import type { LocalLaunchAuthSession } from '../workflow/local-launch.service';
import { QualityLocalLaunchService } from './quality-local-launch.service';
export class QualityLocalLaunchDto {
  @IsString() @MinLength(1) targetId!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) caseIds?: string[];
  @IsOptional() @IsIn(['cursor', 'codex', 'workbuddy']) preferredIde?: 'cursor' | 'codex' | 'workbuddy';
}
export class RedeemQualityLocalLaunchDto {
  @IsString() @MinLength(1) ticket!: string;
  @IsString() @MinLength(1) deviceId!: string;
}
@Controller('quality')
export class QualityLocalLaunchController {
  constructor(private readonly launch: QualityLocalLaunchService) {}
  @Post('test-runs/:id/local-launch')
  issue(@Param('id') id: string, @Body() dto: QualityLocalLaunchDto, @Req() req: { authSession?: LocalLaunchAuthSession }) {
    if (!req.authSession) throw new BadRequestException('请先登录。');
    return this.launch.issueTicket(id, dto, req.authSession);
  }
  @Public() @Post('local-launch/redeem')
  redeem(@Body() dto: RedeemQualityLocalLaunchDto) { return this.launch.redeemTicket(dto.ticket, dto.deviceId); }
}
