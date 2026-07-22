import { Injectable } from '@nestjs/common';
import { ContextPackageService } from '../edge/context-package.service';
import { EdgeHandoffService } from '../edge/edge-handoff.service';
import {
  EdgeTasksService,
  type EdgeTaskItem,
  type EdgeTaskType,
  type EdgeWorkflowSession,
} from '../edge/edge-tasks.service';
import { StartLocalChatDto } from './dto/start-local-chat.dto';

export type LocalChatTaskItem = EdgeTaskItem;

@Injectable()
export class CursorLocalService {
  constructor(
    private readonly edgeTasksService: EdgeTasksService,
    private readonly edgeHandoffService: EdgeHandoffService,
    private readonly contextPackageService: ContextPackageService,
  ) {}

  listTasks(filters: { workspaceId?: string; session?: EdgeWorkflowSession }) {
    return this.edgeTasksService.listTasks(filters);
  }

  startHandoff(dto: StartLocalChatDto, session?: EdgeWorkflowSession) {
    return this.edgeHandoffService.startHandoff(
      { ...dto, sourceTool: 'cursor' },
      session,
    );
  }

  getTaskContext(type: EdgeTaskType, id: string) {
    return this.contextPackageService.getLegacyTaskContext(type, id);
  }
}
