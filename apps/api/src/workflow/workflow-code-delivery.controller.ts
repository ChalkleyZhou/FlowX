import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
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
