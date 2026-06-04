import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { DeliveryTargetsService } from './delivery-targets.service';
import { CreateDeliveryTargetDto } from './dto/create-delivery-target.dto';
import { UpdateDeliveryTargetDto } from './dto/update-delivery-target.dto';

type AuthRequest = {
  authSession?: {
    organization?: { id: string } | null;
  };
};

@Controller('delivery-targets')
export class DeliveryTargetsController {
  constructor(private readonly deliveryTargetsService: DeliveryTargetsService) {}

  @Get()
  list(@Query('workspaceId') workspaceId?: string) {
    return this.deliveryTargetsService.listTargets(workspaceId);
  }

  @Post()
  create(@Body() dto: CreateDeliveryTargetDto, @Req() req: AuthRequest) {
    return this.deliveryTargetsService.createTarget(
      dto,
      req.authSession?.organization?.id ?? undefined,
    );
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDeliveryTargetDto) {
    return this.deliveryTargetsService.updateTarget(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.deliveryTargetsService.deleteTarget(id);
  }
}

