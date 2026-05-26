import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrganizationMemberDto {
  @IsString()
  @IsOptional()
  @MaxLength(64)
  displayName?: string;

  @IsString()
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}
