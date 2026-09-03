import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { CaseLibrariesService } from './case-libraries.service';
import {
  CreateCaseLibraryDto,
  CreateTestCaseDefinitionDto,
  CreateTestCaseModuleDto,
} from './dto/case-library.dto';

@Controller('quality')
export class CaseLibrariesController {
  constructor(private readonly libraries: CaseLibrariesService) {}

  @Post('case-libraries')
  createLibrary(@Body() dto: CreateCaseLibraryDto, @Req() req: QualityRequest) {
    return this.libraries.createLibrary(dto, req.authSession?.user.id);
  }

  @Get('case-libraries')
  listLibraries(@Query('workspaceId') workspaceId: string, @Query('projectId') projectId?: string) {
    return this.libraries.listLibraries({ workspaceId, projectId });
  }

  @Post('case-libraries/:libraryId/modules')
  createModule(@Param('libraryId') libraryId: string, @Body() dto: CreateTestCaseModuleDto) {
    return this.libraries.createModule(libraryId, dto);
  }

  @Post('case-libraries/:libraryId/cases')
  createCase(
    @Param('libraryId') libraryId: string,
    @Body() dto: CreateTestCaseDefinitionDto,
    @Req() req: QualityRequest,
  ) {
    return this.libraries.createCase(libraryId, dto, req.authSession?.user.id);
  }

  @Get('test-cases')
  listCases(
    @Query('workspaceId') workspaceId: string,
    @Query('projectId') projectId?: string,
    @Query('libraryId') libraryId?: string,
    @Query('moduleId') moduleId?: string,
  ) {
    return this.libraries.listCases({ workspaceId, projectId, libraryId, moduleId });
  }
}

type QualityRequest = { authSession?: { user: { id: string } } };
