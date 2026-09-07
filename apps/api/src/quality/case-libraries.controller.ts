import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { CaseLibrariesService } from './case-libraries.service';
import {
  CreateCaseLibraryDto,
  CreateTestCaseDefinitionDto,
  CreateTestCaseModuleDto,
  ImportTestCasesDto,
  ListTestCasesQueryDto,
  UpdateTestCaseDefinitionDto,
  UpdateTestCaseModuleDto,
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

  @Get('case-libraries/:libraryId/modules')
  listModules(@Param('libraryId') libraryId: string) {
    return this.libraries.listModules(libraryId);
  }

  @Patch('test-case-modules/:id')
  updateModule(@Param('id') id: string, @Body() dto: UpdateTestCaseModuleDto) {
    return this.libraries.updateModule(id, dto);
  }

  @Delete('test-case-modules/:id')
  deleteModule(@Param('id') id: string) {
    return this.libraries.deleteModule(id);
  }

  @Post('case-libraries/:libraryId/cases')
  createCase(
    @Param('libraryId') libraryId: string,
    @Body() dto: CreateTestCaseDefinitionDto,
    @Req() req: QualityRequest,
  ) {
    return this.libraries.createCase(libraryId, dto, req.authSession?.user.id);
  }

  @Post('case-libraries/:libraryId/cases/import')
  importCases(
    @Param('libraryId') libraryId: string,
    @Body() dto: ImportTestCasesDto,
    @Req() req: QualityRequest,
  ) {
    return this.libraries.importCases(libraryId, dto, req.authSession?.user.id);
  }

  @Get('test-cases')
  listCases(@Query() query: ListTestCasesQueryDto) {
    return this.libraries.listCases(query);
  }

  @Patch('test-cases/:id')
  updateCase(@Param('id') id: string, @Body() dto: UpdateTestCaseDefinitionDto) {
    return this.libraries.updateCase(id, dto);
  }

  @Delete('test-cases/:id')
  deleteCase(@Param('id') id: string) {
    return this.libraries.deleteCase(id);
  }
}

type QualityRequest = { authSession?: { user: { id: string } } };
