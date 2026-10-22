import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ReleaseLocalTaskDto } from './dto/release-local-task.dto';
import { WorkflowCollaborationActor, WorkflowCollaborationService } from './workflow-collaboration.service';

@Controller('workflow-runs')
export class WorkflowCollaborationController {
  constructor(private readonly collaboration: WorkflowCollaborationService) {}

  @Get(':id/collaboration')
  getCollaboration(@Param('id') id: string, @Req() req: CollaborationRequest) {
    return this.collaboration.getCollaboration(id, req.authSession);
  }

  @Post(':id/local-task/release')
  releaseLocalTask(@Param('id') id: string, @Body() input: ReleaseLocalTaskDto, @Req() req: CollaborationRequest) {
    return this.collaboration.releaseLocalTask(id, input, req.authSession);
  }
}

type CollaborationRequest = { authSession?: WorkflowCollaborationActor };
