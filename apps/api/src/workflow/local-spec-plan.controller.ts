import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { CompleteLocalSpecPlanDto } from './dto/complete-local-spec-plan.dto';
import { WorkflowService } from './workflow.service';

@Controller()
export class LocalSpecPlanController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Post('workflow-runs/:id/spec-plan/claim-local')
  claim(@Param('id') id: string, @Req() req: LocalSpecPlanRequest) {
    return this.workflowService.claimLocalSpecPlan(id, req.authSession);
  }

  @Get('workflow-runs/:id/spec-plan/local-handoff')
  handoff(@Param('id') id: string, @Req() req: LocalSpecPlanRequest) {
    return this.workflowService.getLocalSpecPlanHandoff(id, req.authSession);
  }

  @Post('execution-sessions/:id/spec-plan/complete')
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteLocalSpecPlanDto,
    @Req() req: LocalSpecPlanRequest,
  ) {
    return this.workflowService.completeLocalSpecPlanSession(id, dto, {
      organizationId: req.authSession?.organization?.id,
    });
  }
}

type LocalSpecPlanRequest = {
  authSession?: {
    user: { id: string; displayName: string };
    organization?: {
      id?: string | null;
      providerOrganizationId?: string | null;
      name?: string | null;
    } | null;
  };
};
