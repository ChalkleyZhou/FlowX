import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { DeliveryTargetsService } from './delivery-targets.service';
import { CreateDeliveryTargetDto } from './dto/create-delivery-target.dto';
import { UpdateDeliveryTargetDto } from './dto/update-delivery-target.dto';

@Controller('delivery-targets')
export class DeliveryTargetsController {
  constructor(private readonly deliveryTargetsService: DeliveryTargetsService) {}

  @Get()
  list(@Query('workspaceId') workspaceId?: string) {
    return this.deliveryTargetsService.listTargets(workspaceId);
  }

  @Post()
  create(@Body() dto: CreateDeliveryTargetDto) {
    return this.deliveryTargetsService.createTarget(dto);
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

