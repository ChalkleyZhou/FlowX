import type { PaginationQuery } from '../common/pagination';
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ConfirmCodeDeliveryDto, SubmitCodeBranchDto } from './dto/code-delivery.dto';
import { WorkflowCollaborationActor } from './workflow-collaboration.service';
import { WorkflowCodeDeliveryService } from './workflow-code-delivery.service';
@Controller('workflow-runs')
export class WorkflowCodeDeliveryController {
  constructor(private readonly delivery: WorkflowCodeDeliveryService) {}

  @Get(':id/code-delivery')
  getDelivery(@Param('id') id: string, @Req() req: DeliveryRequest) {
    return this.delivery.getDelivery(id, req.authSession);
  }

  @Get(':id/code-delivery/history')
  listHistory(@Param('id') id: string, @Query() query: PaginationQuery, @Req() req: DeliveryRequest) {
    return this.delivery.listHistory(id, query, req.authSession);
  }

  @Post(':id/code-delivery/branches')
  submitBranch(@Param('id') id: string, @Body() input: SubmitCodeBranchDto, @Req() req: DeliveryRequest) {
    return this.delivery.submitBranch(id, input, req.authSession);
  }

  @Post(':id/code-delivery/confirm')
  confirmDelivery(@Param('id') id: string, @Body() input: ConfirmCodeDeliveryDto, @Req() req: DeliveryRequest) {
    return this.delivery.confirmDelivery(id, input, req.authSession);
  }
}
type DeliveryRequest = { authSession?: WorkflowCollaborationActor };
