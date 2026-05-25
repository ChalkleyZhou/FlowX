import { Controller, Get, Query, Req } from '@nestjs/common';
import { GetScheduleGanttDto } from './dto/get-schedule-gantt.dto';
import { ScheduleService } from './schedule.service';

@Controller('schedule')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get('gantt')
  getGantt(
    @Query() query: GetScheduleGanttDto,
    @Req()
    req: {
      authSession?: {
        user?: { id: string };
        organization?: { id: string } | null;
      };
    },
  ) {
    const scope = query.scope ?? (query.projectId ? 'project' : 'organization');
    const onlyMe = query.onlyMe === 'true' || query.onlyMe === '1';
    const userId = onlyMe ? req.authSession?.user?.id : query.userId;

    return this.scheduleService.buildGanttPayload({
      view: query.view ?? 'member',
      scope,
      projectId: query.projectId,
      organizationId:
        scope === 'organization' ? req.authSession?.organization?.id : undefined,
      from: query.from,
      to: query.to,
      userId,
      requirementId: query.requirementId,
      role: query.role,
    });
  }
}
