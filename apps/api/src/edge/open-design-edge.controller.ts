import { Body, Controller, Get, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CompleteOpenDesignBrainstormDto } from './dto/complete-open-design-brainstorm.dto';
import { CompleteOpenDesignDto } from './dto/complete-open-design.dto';
import { StartOpenDesignHandoffDto } from './dto/start-open-design-handoff.dto';
import type { EdgeWorkflowSession } from './edge-tasks.service';
import { OpenDesignEdgeService } from './open-design-edge.service';

@Controller()
export class OpenDesignEdgeController {
  constructor(private readonly openDesignEdgeService: OpenDesignEdgeService) {}

  @Post('edge/design-handoffs')
  start(@Body() dto: StartOpenDesignHandoffDto, @Req() req: OpenDesignRequest) {
    return this.openDesignEdgeService.startHandoff(dto, requireSession(req));
  }

  @Post('edge/design-handoffs/:workflowRunId/retry')
  retry(@Param('workflowRunId') workflowRunId: string, @Req() req: OpenDesignRequest) {
    return this.openDesignEdgeService.retryHandoff(workflowRunId, requireSession(req));
  }

  @Post('edge/brainstorm-handoffs/:workflowRunId/retry')
  retryBrainstorm(@Param('workflowRunId') workflowRunId: string, @Req() req: OpenDesignRequest) {
    return this.openDesignEdgeService.retryBrainstormHandoff(workflowRunId, requireSession(req));
  }

  @Post('edge/design-launch/redeem')
  @Public()
  redeem(@Body() body: { ticket?: string }) {
    return this.openDesignEdgeService.redeem(body.ticket?.trim() ?? '');
  }

  @Post('execution-sessions/:id/design/complete')
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteOpenDesignDto,
    @Req() req: OpenDesignRequest,
  ) {
    return this.openDesignEdgeService.complete(id, dto, {
      organizationId: req.authSession?.organization?.id ?? null,
    });
  }

  @Post('execution-sessions/:id/brainstorm/complete')
  completeBrainstorm(
    @Param('id') id: string,
    @Body() dto: CompleteOpenDesignBrainstormDto,
    @Req() req: OpenDesignRequest,
  ) {
    return this.openDesignEdgeService.completeBrainstorm(id, dto, {
      organizationId: req.authSession?.organization?.id ?? null,
    });
  }

  @Get('workflow-runs/:id/design/local-handoff')
  getHandoff(@Param('id') id: string, @Req() req: OpenDesignRequest) {
    return this.openDesignEdgeService.getHandoff(id, req.authSession);
  }

  @Get('workflow-runs/:id/brainstorm/local-handoff')
  getBrainstormHandoff(@Param('id') id: string, @Req() req: OpenDesignRequest) {
    return this.openDesignEdgeService.getBrainstormHandoff(id, req.authSession);
  }
}

type OpenDesignRequest = { authSession?: EdgeWorkflowSession };

function requireSession(req: OpenDesignRequest): EdgeWorkflowSession {
  if (!req.authSession?.user?.id) {
    throw new UnauthorizedException('Authenticated session is required.');
  }
  return req.authSession;
}
