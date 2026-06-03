import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { BriefingsService } from './briefings.service';
import { GenerateBriefingDto } from './dto/generate-briefing.dto';
import { UpsertProjectBriefingConfigDto } from './dto/upsert-project-briefing-config.dto';

@Controller()
export class BriefingsController {
  constructor(private readonly briefingsService: BriefingsService) {}

  @Get('projects/:id/briefing-config')
  getProjectConfig(@Param('id') id: string) {
    return this.briefingsService.getProjectConfig(id);
  }

  @Put('projects/:id/briefing-config')
  updateProjectConfig(@Param('id') id: string, @Body() dto: UpsertProjectBriefingConfigDto) {
    return this.briefingsService.upsertProjectConfig(id, dto);
  }

  @Get('projects/:id/briefings')
  listProjectBriefings(@Param('id') id: string) {
    return this.briefingsService.listProjectBriefings(id);
  }

  @Post('projects/:id/briefings/generate')
  generateProjectBriefing(@Param('id') id: string, @Body() dto: GenerateBriefingDto) {
    return this.briefingsService.generateProjectBriefing(id, dto);
  }

  @Get('briefings/:id')
  getBriefing(@Param('id') id: string) {
    return this.briefingsService.getBriefing(id);
  }

  @Post('briefings/:id/send')
  sendBriefing(@Param('id') id: string) {
    return this.briefingsService.sendBriefing(id);
  }
}

