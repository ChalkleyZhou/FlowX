import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import {
  ClaimLocalSmokeDto,
  CompleteLocalSmokeDto,
  CreateLocalSmokeRunDto,
} from './dto/local-smoke.dto';
import { LocalSmokeService } from './local-smoke.service';

@Controller()
export class LocalSmokeController {
  constructor(private readonly localSmoke: LocalSmokeService) {}

  @Post('quality/test-requests/:id/local-smoke-runs')
  create(@Param('id') id: string, @Body() dto: CreateLocalSmokeRunDto, @Req() req: QualityRequest) {
    return this.localSmoke.createRun(id, dto, req.authSession?.user.id);
  }

  @Get('quality/test-requests/:id/local-smoke-runs')
  list(@Param('id') id: string) {
    return this.localSmoke.listRuns(id);
  }

  @Get('quality/local-smoke-runs/:id/tasks')
  tasks(@Param('id') id: string) {
    return this.localSmoke.getTasks(id);
  }

  @Post('quality/local-smoke-runs/:id/claim')
  claim(@Param('id') id: string, @Body() dto: ClaimLocalSmokeDto, @Req() req: QualityRequest) {
    return this.localSmoke.claim(id, dto, req.authSession?.user.id);
  }

  @Post('quality/local-smoke-runs/:id/finalize')
  finalize(@Param('id') id: string, @Req() req: QualityRequest) {
    return this.localSmoke.finalize(id, req.authSession?.user.id);
  }

  @Get('quality/test-requests/:id/submission-report')
  latestReport(@Param('id') id: string) {
    return this.localSmoke.latestReport(id);
  }

  @Post('execution-sessions/:id/local-smoke/complete')
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteLocalSmokeDto,
    @Req() req: QualityRequest,
  ) {
    return this.localSmoke.complete(id, dto, {
      organizationId: req.authSession?.organization?.id,
    });
  }
}

type QualityRequest = {
  authSession?: {
    user: { id: string };
    organization?: { id?: string | null } | null;
  };
};
