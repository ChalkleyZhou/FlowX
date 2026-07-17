import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CodeReviewSourcesService } from './code-review-sources.service';
import { CreateCodeReviewSourceDto } from './dto/create-code-review-source.dto';
import { UpdateCodeReviewSourceDto } from './dto/update-code-review-source.dto';

@Controller('code-review-sources')
export class CodeReviewSourcesController {
  constructor(private readonly codeReviewSourcesService: CodeReviewSourcesService) {}

  @Get()
  list(@Query('workspaceId') workspaceId?: string) {
    return this.codeReviewSourcesService.listSources(workspaceId);
  }

  @Post()
  create(@Body() dto: CreateCodeReviewSourceDto) {
    return this.codeReviewSourcesService.createSource(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCodeReviewSourceDto) {
    return this.codeReviewSourcesService.updateSource(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.codeReviewSourcesService.deleteSource(id);
  }
}
