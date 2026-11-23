import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizeProjectLabelName, parseProjectLabelFilter, parseProjectLabelIds, PROJECT_LABEL_COLORS, type ProjectLabelColor } from '@flowx-ai/protocol';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pageResult, parsePagination, type PaginationQuery } from '../common/pagination';
type Auth = { organization?: { id?: string | null } | null };
export const workItemLabelsInclude = { select: { label: { select: { id: true, name: true, color: true } } }, orderBy: { labelId: 'asc' as const } };
export function withProjectLabels<T extends { labels?: Array<{ label: { id: string; name: string; color: string } }> }>(item: T) {
  const { labels, ...rest } = item;
  return { ...rest, labels: (labels ?? []).map(({ label }) => ({ ...label, color: label.color as ProjectLabelColor })) };
}
export function labelIdsInput(value: unknown) {
  try { return parseProjectLabelIds(value); } catch (error) { throw new BadRequestException((error as Error).message); }
}
export function labelFilterWhere(value: unknown): Prisma.WorkItemWhereInput {
  let ids: string[];
  try { ids = parseProjectLabelFilter(value); } catch (error) { throw new BadRequestException((error as Error).message); }
  return ids.length ? { labels: { some: { labelId: { in: ids } } } } : {};
}
export async function assertProjectLabelIds(tx: Pick<Prisma.TransactionClient, 'projectLabel'>, projectId: string, ids: string[]) {
  if (!ids.length) return;
  const rows = await tx.projectLabel.findMany({ where: { projectId, id: { in: ids } }, select: { id: true } });
  if (rows.length !== ids.length) throw new NotFoundException({ code: 'PROJECT_LABEL_UNAVAILABLE', message: '部分标签不存在或不属于当前项目，请刷新标签后重试' });
}
export async function replaceWorkItemLabels(tx: Prisma.TransactionClient, projectId: string, workItemId: string, ids: string[]) {
  await assertProjectLabelIds(tx, projectId, ids);
  await tx.workItemLabel.deleteMany({ where: { workItemId } });
  if (ids.length) await tx.workItemLabel.createMany({ data: ids.map(labelId => ({ workItemId, labelId })) });
}
@Injectable()
export class ProjectLabelsService {
  constructor(private readonly prisma: PrismaService) {}
  private async project(projectId: string, auth?: Auth) {
    if (!auth?.organization?.id) throw new ForbiddenException('Organization context is required.');
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspace: { organizationId: auth.organization.id } }, select: { id: true } });
    if (!project) throw new NotFoundException('项目不存在。');
  }
  async listPage(projectId: string, query: PaginationQuery & { q?: string } = {}, auth?: Auth) {
    await this.project(projectId, auth);
    const paging = parsePagination(query);
    if (query.q !== undefined && typeof query.q !== 'string') throw new BadRequestException('q 必须是字符串。');
    const where = { projectId, ...(query.q?.trim() ? { name: { contains: query.q.trim().normalize('NFC') } } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.projectLabel.findMany({ where, skip: paging.skip, take: paging.take, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { _count: { select: { workItems: true } } } }),
      this.prisma.projectLabel.count({ where }),
    ]);
    return pageResult(rows.map(({ _count, nameKey: _nameKey, ...row }) => ({ ...row, workItemCount: _count.workItems })), total, paging);
  }
  private fields(dto: { name?: unknown; color?: unknown }) {
    let name: string | undefined;
    if (dto.name !== undefined) { try { name = normalizeProjectLabelName(dto.name); } catch (error) { throw new BadRequestException((error as Error).message); } }
    if (dto.color !== undefined && !PROJECT_LABEL_COLORS.includes(dto.color as ProjectLabelColor)) throw new BadRequestException('不支持的标签颜色。');
    return { ...(name !== undefined ? { name, nameKey: name.toLowerCase() } : {}), ...(dto.color !== undefined ? { color: dto.color as ProjectLabelColor } : {}) };
  }
  private rethrow(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException({ code: 'PROJECT_LABEL_NAME_CONFLICT', message: '当前项目已存在同名标签。' });
    throw error;
  }
  async create(projectId: string, dto: { name: unknown; color?: unknown }, auth?: Auth) {
    await this.project(projectId, auth);
    const fields = this.fields(dto);
    if (!fields.name) throw new BadRequestException('请填写标签名称。');
    try {
      const { nameKey: _nameKey, ...label } = await this.prisma.projectLabel.create({ data: { projectId, name: fields.name, nameKey: fields.nameKey!, color: fields.color ?? 'BLUE' } });
      return { ...label, workItemCount: 0 };
    } catch (error) { this.rethrow(error); }
  }
  async update(projectId: string, labelId: string, dto: { name?: unknown; color?: unknown; updatedAt?: string }, auth?: Auth) {
    await this.project(projectId, auth);
    if (dto.name === undefined && dto.color === undefined) throw new BadRequestException('请至少修改名称或颜色。');
    if (dto.updatedAt !== undefined && Number.isNaN(Date.parse(dto.updatedAt))) throw new BadRequestException('updatedAt 无效。');
    const data = this.fields(dto);
    try { return await this.prisma.$transaction(async tx => {
      if (!await tx.projectLabel.findFirst({ where: { id: labelId, projectId } })) throw new NotFoundException('标签不存在。');
      const result = await tx.projectLabel.updateMany({ where: { id: labelId, projectId, ...(dto.updatedAt ? { updatedAt: new Date(dto.updatedAt) } : {}) }, data });
      if (!result.count) throw new ConflictException({ code: 'RESOURCE_UPDATED', message: '标签已被其他人更新，请刷新后重试。' });
      const { nameKey: _nameKey, _count, ...label } = await tx.projectLabel.findUniqueOrThrow({ where: { id: labelId }, include: { _count: { select: { workItems: true } } } });
      return { ...label, workItemCount: _count.workItems };
    }); } catch (error) { this.rethrow(error); }
  }
  async remove(projectId: string, labelId: string, auth?: Auth) {
    await this.project(projectId, auth);
    return this.prisma.$transaction(async tx => {
      const label = await tx.projectLabel.findFirst({ where: { id: labelId, projectId }, include: { _count: { select: { workItems: true } } } });
      if (!label) throw new NotFoundException('标签不存在。');
      await tx.projectLabel.delete({ where: { id: labelId } });
      return { ok: true as const, removedAssociations: label._count.workItems };
    });
  }
}
