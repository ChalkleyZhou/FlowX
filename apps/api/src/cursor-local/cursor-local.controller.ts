import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { CursorLocalService } from './cursor-local.service';
import { StartLocalChatDto } from './dto/start-local-chat.dto';

@Controller('cursor-local')
export class CursorLocalController {
  constructor(private readonly cursorLocalService: CursorLocalService) {}

  @Get('tasks')
  listTasks(@Query('workspaceId') workspaceId: string | undefined, @Req() req: CursorLocalRequest) {
    return this.cursorLocalService.listTasks({ workspaceId, session: req.authSession });
  }

  @Post('handoff')
  startHandoff(@Body() dto: StartLocalChatDto, @Req() req: CursorLocalRequest) {
    return this.cursorLocalService.startHandoff(dto, req.authSession);
  }

  @Get('tasks/:type/:id/context')
  getTaskContext(@Param('type') type: 'requirement' | 'bug', @Param('id') id: string) {
    return this.cursorLocalService.getTaskContext(type, id);
  }
}

type CursorLocalRequest = {
  authSession?: {
    user: {
      id: string;
      displayName: string;
    };
    organization?: {
      id?: string | null;
      providerOrganizationId?: string | null;
      name?: string | null;
    } | null;
  };
};
