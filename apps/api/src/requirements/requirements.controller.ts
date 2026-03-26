import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateRequirementDto } from './dto/create-requirement.dto';
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
}

