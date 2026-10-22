import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreatePrototypeImportDto, PrototypeRevisionDto, UpdatePrototypeImportDto } from './dto/prototype-import.dto';
import { PrototypeImportsService, type PrototypeActor } from './prototype-imports.service';

type Upload = { buffer: Buffer; originalname: string };
type Request = { authSession?: PrototypeActor };
const upload = () => FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 5, fieldSize: 20000 } });
function file(uploaded?: Upload) {
  if (!uploaded?.buffer?.length) throw new BadRequestException('请选择原型 ZIP 包。');
  // multipart filename 按历史约定经 latin1 传递，处理常见中文文件名。
  const name = /[\u0080-\u00ff]/.test(uploaded.originalname) ? Buffer.from(uploaded.originalname, 'latin1').toString('utf8') : uploaded.originalname;
  return { ...uploaded, originalname: name.replace(/[\\/\r\n]/g, '_').slice(0, 200) };
}
@Controller('prototype-imports')
export class PrototypeImportsController {
  constructor(private readonly imports: PrototypeImportsService) {}
  @Post() @UseInterceptors(upload())
  create(@Body() dto: CreatePrototypeImportDto, @UploadedFile() uploaded: Upload | undefined, @Req() req: Request) {
    const value = file(uploaded);
    return this.imports.create(dto, value.buffer, value.originalname, req.authSession);
  }
  @Get(':id')
  get(@Param('id') id: string, @Req() req: Request) { return this.imports.get(id, req.authSession); }
  @Patch(':id')
  save(@Param('id') id: string, @Body() dto: UpdatePrototypeImportDto, @Req() req: Request) { return this.imports.save(id, dto, req.authSession); }
  @Post(':id/analyze')
  analyze(@Param('id') id: string, @Body() dto: UpdatePrototypeImportDto, @Req() req: Request) { return this.imports.analyze(id, dto, req.authSession); }
  @Post(':id/files') @UseInterceptors(upload())
  supplement(@Param('id') id: string, @Body() dto: PrototypeRevisionDto, @UploadedFile() uploaded: Upload | undefined, @Req() req: Request) {
    const value = file(uploaded);
    return this.imports.supplement(id, dto, value.buffer, value.originalname, req.authSession);
  }
  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body() dto: UpdatePrototypeImportDto, @Req() req: Request) { return this.imports.confirm(id, dto, req.authSession); }
  @Get(':id/preview')
  preview(@Param('id') id: string, @Query('path') path: string, @Req() req: Request) { return this.imports.preview(id, path, req.authSession); }
  @Get(':id/source')
  async download(@Param('id') id: string, @Query('revision') revision: string | undefined, @Req() req: Request) {
    const version = revision === undefined ? undefined : Number(revision);
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) throw new BadRequestException('原始包版本无效。');
    const buffer = await this.imports.download(id, version, req.authSession);
    return new StreamableFile(buffer, { type: 'application/zip', disposition: 'attachment; filename="prototype.zip"', length: buffer.length });
  }
}
