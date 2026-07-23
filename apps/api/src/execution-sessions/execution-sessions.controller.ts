import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { AppendSyncEventDto } from './dto/append-sync-event.dto';
import { CompleteExecutionSessionDto } from './dto/complete-execution-session.dto';
import { FailExecutionSessionDto } from './dto/fail-execution-session.dto';
import { HeartbeatExecutionSessionDto } from './dto/heartbeat-execution-session.dto';
import { ExecutionSessionsService } from './execution-sessions.service';
import { SyncEventsService } from './sync-events.service';

@Controller('execution-sessions')
export class ExecutionSessionsController {
  constructor(
    private readonly executionSessionsService: ExecutionSessionsService,
    private readonly syncEventsService: SyncEventsService,
  ) {}

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: ExecutionSessionRequest) {
    return this.executionSessionsService.findOne(id, toScope(req));
  }

  @Get(':id/events')
  listEvents(
    @Param('id') id: string,
    @Query('cursor') cursor: string | undefined,
    @Query('take') rawTake: string | undefined,
    @Req() req: ExecutionSessionRequest,
  ) {
    const parsedTake = rawTake ? Number.parseInt(rawTake, 10) : undefined;
    return this.syncEventsService.list(
      id,
      {
        cursor: cursor?.trim() || undefined,
        take: Number.isFinite(parsedTake) ? parsedTake : undefined,
      },
      toScope(req),
    );
  }

  @Post(':id/events')
  appendEvent(
    @Param('id') id: string,
    @Body() dto: AppendSyncEventDto,
    @Req() req: ExecutionSessionRequest,
  ) {
    return this.syncEventsService.append(id, dto, toScope(req));
  }

  @Post(':id/start')
  markRunning(@Param('id') id: string, @Req() req: ExecutionSessionRequest) {
    return this.executionSessionsService.markRunning(id, toScope(req));
  }

  @Post(':id/heartbeat')
  heartbeat(
    @Param('id') id: string,
    @Body() dto: HeartbeatExecutionSessionDto,
    @Req() req: ExecutionSessionRequest,
  ) {
    return this.executionSessionsService.heartbeat(
      id,
      dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      toScope(req),
    );
  }

  @Post(':id/complete')
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteExecutionSessionDto,
    @Req() req: ExecutionSessionRequest,
  ) {
    const userId = req.authSession?.user?.id;
    return this.executionSessionsService.complete(id, dto, {
      ...toScope(req),
      notifySession: userId
        ? {
            user: {
              id: userId,
              displayName: req.authSession?.user?.displayName ?? userId,
            },
            organization: req.authSession?.organization,
          }
        : undefined,
    });
  }

  @Post(':id/fail')
  fail(
    @Param('id') id: string,
    @Body() dto: FailExecutionSessionDto,
    @Req() req: ExecutionSessionRequest,
  ) {
    return this.executionSessionsService.fail(id, dto, toScope(req));
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CompleteExecutionSessionDto,
    @Req() req: ExecutionSessionRequest,
  ) {
    return this.executionSessionsService.cancel(id, dto, toScope(req));
  }
}

type ExecutionSessionRequest = {
  authSession?: {
    user?: { id?: string | null; displayName?: string | null } | null;
    organization?: {
      id?: string | null;
      providerOrganizationId?: string | null;
      name?: string | null;
    } | null;
  };
};

function toScope(req: ExecutionSessionRequest) {
  return {
    userId: req.authSession?.user?.id ?? null,
    organizationId: req.authSession?.organization?.id ?? null,
  };
}
