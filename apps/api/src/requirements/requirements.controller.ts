import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { ReviseBrainstormDto, ReviseDesignDto, StartBrainstormDto, StartDesignDto } from './dto/ideation.dto';
import { RequirementsService } from './requirements.service';

@Controller('requirements')
export class RequirementsController {
  constructor(private readonly requirementsService: RequirementsService) {}

  @Post()
  create(@Body() dto: CreateRequirementDto) {
    return this.requirementsService.create(dto);
  }

  @Get()
  findAll() {
    return this.requirementsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.requirementsService.findOne(id);
  }

  // ── Ideation endpoints ──

  @Post(':id/brainstorm/run')
  startBrainstorm(@Param('id') id: string, @Body() dto: StartBrainstormDto) {
    return this.requirementsService.startBrainstorm(id, dto.humanHint);
  }

  @Post(':id/brainstorm/revise')
  reviseBrainstorm(@Param('id') id: string, @Body() dto: ReviseBrainstormDto) {
    return this.requirementsService.reviseBrainstorm(id, dto.feedback);
  }

  @Post(':id/brainstorm/confirm')
  confirmBrainstorm(@Param('id') id: string) {
    return this.requirementsService.confirmBrainstorm(id);
  }

  @Post(':id/design/run')
  startDesign(@Param('id') id: string, @Body() dto: StartDesignDto) {
    return this.requirementsService.startDesign(id, dto.humanHint);
  }

  @Post(':id/design/revise')
  reviseDesign(@Param('id') id: string, @Body() dto: ReviseDesignDto) {
    return this.requirementsService.reviseDesign(id, dto.feedback);
  }

  @Post(':id/design/confirm')
  confirmDesign(@Param('id') id: string) {
    return this.requirementsService.confirmDesign(id);
  }

  @Post(':id/ideation/finalize')
  finalizeIdeation(@Param('id') id: string) {
    return this.requirementsService.finalizeIdeation(id);
  }
}
